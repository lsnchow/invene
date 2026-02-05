"""
Relay API routes for Web Orchestrator integration.

Endpoints:
- POST /relay/jobs          - Create a new job with TaskGraph
- GET  /relay/jobs/next     - Poll for next pending job (Invene)
- POST /relay/jobs/{job_id}/start   - Mark job as started
- POST /relay/jobs/{job_id}/complete - Mark job as completed
- POST /relay/jobs/{job_id}/fail    - Mark job as failed
- POST /relay/events        - Post execution event (Invene)
- GET  /relay/events/stream/{graph_id} - SSE stream for events
- GET  /relay/graphs/{graph_id}      - Get full graph state
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from lightning_loop.relay.database import get_db, init_db
from lightning_loop.relay.models import EventType, JobStatus
from lightning_loop.relay.service import RelayService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/relay", tags=["relay"])

# Initialize database on module load
init_db()


# ============================================================================
# Request/Response Models
# ============================================================================

class SliderPreset(BaseModel):
    """Slider configuration for graph generation."""
    verbosity: str = Field(default="medium", pattern="^(low|medium|high)$")
    autonomy: str = Field(default="medium", pattern="^(low|medium|high)$")
    risk_tolerance: str = Field(default="safe", pattern="^(safe|aggressive)$")


class DocumentRef(BaseModel):
    """Document reference for task nodes."""
    doc_id: str
    filename: str
    extracted_summary: Optional[str] = None
    chunk_refs: Optional[List[str]] = None


class TaskNode(BaseModel):
    """A node in the task graph."""
    node_id: str
    title: str
    node_type: str = Field(..., pattern="^(planning|execution|validation|doc_index|memory|output)$")
    objective: str
    constraints: Optional[List[str]] = None
    success_checks: Optional[List[str]] = None
    doc_refs: Optional[List[str]] = None
    dependencies: List[str] = Field(default_factory=list)
    ralph_profile: Optional[str] = None


class TaskEdge(BaseModel):
    """An edge in the task graph."""
    from_node_id: str
    to_node_id: str
    edge_type: str = Field(default="depends_on", pattern="^(depends_on|uses_doc|produces_artifact)$")


class TaskGraphInput(BaseModel):
    """Full TaskGraph as sent from web app."""
    user_request: str
    slider_preset: SliderPreset = Field(default_factory=SliderPreset)
    inputs: Optional[Dict[str, Any]] = None
    nodes: List[TaskNode]
    edges: List[TaskEdge] = Field(default_factory=list)


class CreateJobRequest(BaseModel):
    """Request to create a new job."""
    taskgraph: TaskGraphInput


class CreateJobResponse(BaseModel):
    """Response after creating a job."""
    graph_id: str
    job_id: str
    status: str
    total_nodes: int


class ClaimJobRequest(BaseModel):
    """Request to claim a pending job."""
    claimed_by: str = Field(..., description="Identifier of the claiming Invene instance")


class JobResponse(BaseModel):
    """Job details response."""
    job_id: str
    graph_id: str
    status: str
    taskgraph: Dict[str, Any]
    current_node_id: Optional[str] = None
    current_node_index: int = 0


class JobListItem(BaseModel):
    """Job list item for queue visibility."""
    job_id: str
    graph_id: str
    status: str
    created_at: str
    claimed_by: Optional[str] = None
    current_node_id: Optional[str] = None
    current_node_index: int = 0
    user_request: Optional[str] = None
    total_nodes: Optional[int] = None


class PostEventRequest(BaseModel):
    """Request to post an execution event."""
    graph_id: str
    node_id: Optional[str] = None
    event_type: str
    message: Optional[str] = None
    artifacts: Optional[List[Dict[str, Any]]] = None
    metrics: Optional[Dict[str, Any]] = None


class EventResponse(BaseModel):
    """Event details response."""
    event_id: int
    graph_id: str
    node_id: Optional[str]
    event_type: str
    timestamp: str
    message: Optional[str]
    artifacts: Optional[List[Dict[str, Any]]]
    metrics: Optional[Dict[str, Any]]


class GraphStateResponse(BaseModel):
    """Full graph state response."""
    graph_id: str
    created_at: str
    user_request: str
    taskgraph: Dict[str, Any]
    sliders: Dict[str, str]
    stats: Dict[str, int]
    job: Optional[Dict[str, Any]]
    node_statuses: Dict[str, Dict[str, Any]]


# ============================================================================
# Routes
# ============================================================================

@router.post("/jobs", response_model=CreateJobResponse)
def create_job(request: CreateJobRequest, db: Session = Depends(get_db)):
    """
    Create a new job from a TaskGraph.
    Called by web app after generating a graph.
    """
    tg = request.taskgraph
    
    # Build taskgraph_json matching PRD spec
    taskgraph_json = {
        "graph_id": None,  # Will be set by service
        "created_at": datetime.utcnow().isoformat(),
        "user_request": tg.user_request,
        "slider_preset": tg.slider_preset.model_dump(),
        "inputs": tg.inputs or {},
        "nodes": [n.model_dump() for n in tg.nodes],
        "edges": [e.model_dump() for e in tg.edges],
    }
    
    graph = RelayService.create_graph(
        db=db,
        user_request=tg.user_request,
        taskgraph_json=taskgraph_json,
        verbosity=tg.slider_preset.verbosity,
        autonomy=tg.slider_preset.autonomy,
        risk_tolerance=tg.slider_preset.risk_tolerance,
    )
    
    # Update graph_id in taskgraph_json
    graph.taskgraph_json["graph_id"] = graph.graph_id
    db.commit()
    
    # Get the job
    job = graph.jobs[0] if graph.jobs else None
    
    logger.info(f"Created job {job.job_id} for graph {graph.graph_id} with {graph.total_nodes} nodes")
    
    return CreateJobResponse(
        graph_id=graph.graph_id,
        job_id=job.job_id if job else "",
        status=job.status.value if job else "unknown",
        total_nodes=graph.total_nodes,
    )


@router.get("/jobs/list", response_model=List[JobListItem])
def list_jobs(
    status: Optional[str] = Query(None, description="Filter by job status"),
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    List recent jobs without claiming them.
    Useful for web UI queue/debugging.
    """
    job_status = None
    if status:
        try:
            job_status = JobStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    jobs = RelayService.list_jobs(db, status=job_status, limit=limit)
    logger.info(f"Listing {len(jobs)} jobs (status={status or 'all'})")

    results: List[JobListItem] = []
    for job in jobs:
        graph = job.graph
        results.append(
            JobListItem(
                job_id=job.job_id,
                graph_id=job.graph_id,
                status=job.status.value,
                created_at=job.created_at.isoformat(),
                claimed_by=job.claimed_by,
                current_node_id=job.current_node_id,
                current_node_index=job.current_node_index,
                user_request=graph.user_request if graph else None,
                total_nodes=graph.total_nodes if graph else None,
            )
        )

    return results


@router.post("/jobs/next", response_model=Optional[JobResponse])
def get_next_job(request: ClaimJobRequest, db: Session = Depends(get_db)):
    """
    Poll for and claim the next pending job.
    Called by Invene to get work.
    Returns null if no pending jobs.
    """
    logger.info(f"Job poll request from {request.claimed_by}")
    job = RelayService.get_next_pending_job(db, claimed_by=request.claimed_by)
    
    if not job:
        logger.info("No pending jobs to claim")
        return None
    
    graph = RelayService.get_graph(db, job.graph_id)
    
    logger.info(f"Job {job.job_id} claimed by {request.claimed_by}")
    
    return JobResponse(
        job_id=job.job_id,
        graph_id=job.graph_id,
        status=job.status.value,
        taskgraph=graph.taskgraph_json if graph else {},
        current_node_id=job.current_node_id,
        current_node_index=job.current_node_index,
    )


@router.post("/jobs/{job_id}/start")
def start_job(job_id: str, db: Session = Depends(get_db)):
    """Mark a claimed job as running."""
    logger.info(f"Starting job {job_id}")
    job = RelayService.start_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or not claimable")
    
    # Add job started event
    RelayService.add_event(
        db=db,
        graph_id=job.graph_id,
        event_type=EventType.JOB_STARTED,
        message="Invene started executing the task graph",
    )
    
    logger.info(f"Job {job_id} started")
    return {"status": "started", "job_id": job_id}


@router.post("/jobs/{job_id}/complete")
def complete_job(job_id: str, db: Session = Depends(get_db)):
    """Mark a running job as completed."""
    job = RelayService.complete_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Add job completed event
    RelayService.add_event(
        db=db,
        graph_id=job.graph_id,
        event_type=EventType.JOB_COMPLETED,
        message="All nodes completed successfully",
    )
    
    logger.info(f"Job {job_id} completed")
    return {"status": "completed", "job_id": job_id}


@router.post("/jobs/{job_id}/fail")
def fail_job(job_id: str, error_message: str = Query(...), db: Session = Depends(get_db)):
    """Mark a job as failed."""
    job = RelayService.fail_job(db, job_id, error_message)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Add job failed event
    RelayService.add_event(
        db=db,
        graph_id=job.graph_id,
        event_type=EventType.JOB_FAILED,
        message=error_message,
    )
    
    logger.info(f"Job {job_id} failed: {error_message}")
    return {"status": "failed", "job_id": job_id}


@router.post("/jobs/{job_id}/progress")
def update_job_progress(
    job_id: str, 
    node_id: str = Query(...),
    node_index: int = Query(...),
    db: Session = Depends(get_db)
):
    """Update current node being executed."""
    job = RelayService.update_job_progress(db, job_id, node_id, node_index)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "updated", "job_id": job_id, "node_id": node_id}


@router.post("/events", response_model=EventResponse)
def post_event(request: PostEventRequest, db: Session = Depends(get_db)):
    """
    Post an execution event.
    Called by Invene during task execution.
    """
    try:
        event_type = EventType(request.event_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid event_type: {request.event_type}")
    
    event = RelayService.add_event(
        db=db,
        graph_id=request.graph_id,
        event_type=event_type,
        node_id=request.node_id,
        message=request.message,
        artifacts=request.artifacts,
        metrics=request.metrics,
    )
    
    logger.debug(f"Event {event.event_id} posted for graph {request.graph_id} node {request.node_id}")
    
    return EventResponse(
        event_id=event.event_id,
        graph_id=event.graph_id,
        node_id=event.node_id,
        event_type=event.event_type.value,
        timestamp=event.timestamp.isoformat(),
        message=event.message,
        artifacts=event.artifacts,
        metrics=event.metrics,
    )


@router.get("/events/stream/{graph_id}")
async def stream_events(
    graph_id: str, 
    since_event_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """
    SSE stream of execution events for a graph.
    Web app subscribes to this for live updates.
    """
    # Verify graph exists
    graph = RelayService.get_graph(db, graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")
    
    async def event_generator():
        last_event_id = since_event_id
        
        while True:
            # Get new events
            events = RelayService.get_events(db, graph_id, since_event_id=last_event_id)
            
            for event in events:
                data = {
                    "event_id": event.event_id,
                    "graph_id": event.graph_id,
                    "node_id": event.node_id,
                    "event_type": event.event_type.value,
                    "timestamp": event.timestamp.isoformat(),
                    "message": event.message,
                    "artifacts": event.artifacts,
                    "metrics": event.metrics,
                }
                yield f"data: {json.dumps(data)}\n\n"
                last_event_id = event.event_id
            
            # Check if job is complete
            job = db.query(Job).filter(Job.graph_id == graph_id).first()
            if job and job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
                yield f"data: {json.dumps({'type': 'stream_end', 'status': job.status.value})}\n\n"
                break
            
            # Heartbeat and poll delay
            yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
            await asyncio.sleep(0.5)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/graphs/{graph_id}", response_model=GraphStateResponse)
def get_graph_state(graph_id: str, db: Session = Depends(get_db)):
    """
    Get full graph state including node statuses.
    Used for initial load and crash recovery.
    """
    state = RelayService.get_graph_state(db, graph_id)
    if not state:
        raise HTTPException(status_code=404, detail="Graph not found")
    
    return GraphStateResponse(**state)


@router.delete("/graphs/{graph_id}")
def delete_graph(graph_id: str, db: Session = Depends(get_db)):
    """Delete a graph and all associated data."""
    graph = RelayService.get_graph(db, graph_id)
    if not graph:
        raise HTTPException(status_code=404, detail="Graph not found")
    
    db.delete(graph)
    db.commit()
    
    logger.info(f"Graph {graph_id} deleted")
    return {"status": "deleted", "graph_id": graph_id}


@router.post("/cleanup")
def cleanup_expired(db: Session = Depends(get_db)):
    """Cleanup expired graphs. Called periodically."""
    count = RelayService.cleanup_expired(db)
    logger.info(f"Cleaned up {count} expired graphs")
    return {"deleted": count}
