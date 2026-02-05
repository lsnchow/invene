"""
Relay service - business logic for graph/job/event management.
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_

from .models import Graph, Job, Event, JobStatus, EventType


class RelayService:
    """Service layer for relay operations."""
    
    # TTL for graphs (24 hours for demo)
    DEFAULT_TTL_HOURS = 24
    
    @staticmethod
    def create_graph(
        db: Session,
        user_request: str,
        taskgraph_json: Dict[str, Any],
        verbosity: str = "medium",
        autonomy: str = "medium",
        risk_tolerance: str = "safe",
        ttl_hours: int = DEFAULT_TTL_HOURS,
    ) -> Graph:
        """Create a new graph and associated pending job."""
        graph_id = str(uuid.uuid4())
        
        # Count nodes
        nodes = taskgraph_json.get("nodes", [])
        total_nodes = len(nodes)
        
        graph = Graph(
            graph_id=graph_id,
            user_request=user_request,
            taskgraph_json=taskgraph_json,
            verbosity=verbosity,
            autonomy=autonomy,
            risk_tolerance=risk_tolerance,
            total_nodes=total_nodes,
            expires_at=datetime.utcnow() + timedelta(hours=ttl_hours),
        )
        db.add(graph)
        
        # Create pending job
        job = Job(
            job_id=str(uuid.uuid4()),
            graph_id=graph_id,
            status=JobStatus.PENDING,
        )
        db.add(job)
        
        db.commit()
        db.refresh(graph)
        return graph
    
    @staticmethod
    def get_graph(db: Session, graph_id: str) -> Optional[Graph]:
        """Get a graph by ID."""
        return db.query(Graph).filter(Graph.graph_id == graph_id).first()
    
    @staticmethod
    def get_next_pending_job(db: Session, claimed_by: str) -> Optional[Job]:
        """
        Get and claim the next pending job (FIFO).
        Returns None if no pending jobs.
        """
        job = (
            db.query(Job)
            .filter(Job.status == JobStatus.PENDING)
            .order_by(Job.created_at.asc())
            .with_for_update(skip_locked=True)  # Prevent race conditions
            .first()
        )
        
        if job:
            job.status = JobStatus.CLAIMED
            job.claimed_at = datetime.utcnow()
            job.claimed_by = claimed_by
            db.commit()
            db.refresh(job)
        
        return job

    @staticmethod
    def list_jobs(
        db: Session,
        status: Optional[JobStatus] = None,
        limit: int = 20,
    ) -> List[Job]:
        """List recent jobs without claiming them (for UI/debug)."""
        query = db.query(Job).order_by(Job.created_at.desc())
        if status:
            query = query.filter(Job.status == status)
        return query.limit(limit).all()
    
    @staticmethod
    def start_job(db: Session, job_id: str) -> Optional[Job]:
        """Mark a job as running."""
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if job and job.status == JobStatus.CLAIMED:
            job.status = JobStatus.RUNNING
            job.started_at = datetime.utcnow()
            db.commit()
            db.refresh(job)
        return job
    
    @staticmethod
    def complete_job(db: Session, job_id: str) -> Optional[Job]:
        """Mark a job as completed."""
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if job:
            job.status = JobStatus.COMPLETED
            job.completed_at = datetime.utcnow()
            db.commit()
            db.refresh(job)
        return job
    
    @staticmethod
    def fail_job(db: Session, job_id: str, error_message: str) -> Optional[Job]:
        """Mark a job as failed."""
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if job:
            job.status = JobStatus.FAILED
            job.completed_at = datetime.utcnow()
            job.error_message = error_message
            db.commit()
            db.refresh(job)
        return job
    
    @staticmethod
    def update_job_progress(
        db: Session, 
        job_id: str, 
        node_id: str, 
        node_index: int
    ) -> Optional[Job]:
        """Update current node being executed."""
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if job:
            job.current_node_id = node_id
            job.current_node_index = node_index
            db.commit()
            db.refresh(job)
        return job
    
    @staticmethod
    def add_event(
        db: Session,
        graph_id: str,
        event_type: EventType,
        node_id: Optional[str] = None,
        message: Optional[str] = None,
        artifacts: Optional[List[Dict[str, Any]]] = None,
        metrics: Optional[Dict[str, Any]] = None,
    ) -> Event:
        """Add an execution event."""
        event = Event(
            graph_id=graph_id,
            node_id=node_id,
            event_type=event_type,
            message=message,
            artifacts=artifacts,
            metrics=metrics,
        )
        db.add(event)
        
        # Update graph node counts if applicable
        if event_type == EventType.DONE and node_id:
            graph = db.query(Graph).filter(Graph.graph_id == graph_id).first()
            if graph:
                graph.completed_nodes += 1
        elif event_type == EventType.FAILED and node_id:
            graph = db.query(Graph).filter(Graph.graph_id == graph_id).first()
            if graph:
                graph.failed_nodes += 1
        
        db.commit()
        db.refresh(event)
        return event
    
    @staticmethod
    def get_events(
        db: Session,
        graph_id: str,
        since_event_id: Optional[int] = None,
        limit: int = 100,
    ) -> List[Event]:
        """Get events for a graph, optionally since a specific event ID."""
        query = db.query(Event).filter(Event.graph_id == graph_id)
        
        if since_event_id is not None:
            query = query.filter(Event.event_id > since_event_id)
        
        return query.order_by(Event.event_id.asc()).limit(limit).all()
    
    @staticmethod
    def get_graph_state(db: Session, graph_id: str) -> Optional[Dict[str, Any]]:
        """
        Get full graph state including latest event per node.
        Used for initial load and crash recovery.
        """
        graph = db.query(Graph).filter(Graph.graph_id == graph_id).first()
        if not graph:
            return None
        
        # Get job status
        job = db.query(Job).filter(Job.graph_id == graph_id).first()
        
        # Get latest event per node
        events = db.query(Event).filter(Event.graph_id == graph_id).all()
        
        # Build node status map
        node_statuses = {}
        for event in events:
            if event.node_id:
                if event.node_id not in node_statuses:
                    node_statuses[event.node_id] = {
                        "status": event.event_type.value,
                        "message": event.message,
                        "artifacts": event.artifacts,
                        "metrics": event.metrics,
                        "updated_at": event.timestamp.isoformat(),
                    }
                else:
                    # Keep latest event
                    node_statuses[event.node_id] = {
                        "status": event.event_type.value,
                        "message": event.message,
                        "artifacts": event.artifacts,
                        "metrics": event.metrics,
                        "updated_at": event.timestamp.isoformat(),
                    }
        
        return {
            "graph_id": graph.graph_id,
            "created_at": graph.created_at.isoformat(),
            "user_request": graph.user_request,
            "taskgraph": graph.taskgraph_json,
            "sliders": {
                "verbosity": graph.verbosity,
                "autonomy": graph.autonomy,
                "risk_tolerance": graph.risk_tolerance,
            },
            "stats": {
                "total_nodes": graph.total_nodes,
                "completed_nodes": graph.completed_nodes,
                "failed_nodes": graph.failed_nodes,
            },
            "job": {
                "job_id": job.job_id if job else None,
                "status": job.status.value if job else None,
                "current_node_id": job.current_node_id if job else None,
                "current_node_index": job.current_node_index if job else None,
            } if job else None,
            "node_statuses": node_statuses,
        }
    
    @staticmethod
    def cleanup_expired(db: Session) -> int:
        """Delete expired graphs. Returns count deleted."""
        now = datetime.utcnow()
        expired = db.query(Graph).filter(
            and_(Graph.expires_at.isnot(None), Graph.expires_at < now)
        ).all()
        
        count = len(expired)
        for graph in expired:
            db.delete(graph)
        
        db.commit()
        return count
