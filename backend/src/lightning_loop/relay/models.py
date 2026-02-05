"""
SQLAlchemy models for relay persistence.

Tables:
- graphs: Stores TaskGraph JSON with metadata
- jobs: Job queue for Invene to poll
- events: Append-only execution events from Invene
"""
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Column, String, Text, DateTime, Enum, ForeignKey, Integer, JSON, Index
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class JobStatus(str, enum.Enum):
    """Job lifecycle states."""
    PENDING = "pending"       # Waiting for Invene to pick up
    CLAIMED = "claimed"       # Invene has claimed but not started
    RUNNING = "running"       # Currently executing
    COMPLETED = "completed"   # All nodes done successfully
    FAILED = "failed"         # Stopped due to unrecoverable error
    CANCELLED = "cancelled"   # User cancelled


class EventType(str, enum.Enum):
    """Execution event types matching PRD spec."""
    QUEUED = "queued"
    RUNNING = "running"
    PROGRESS = "progress"
    DONE = "done"
    FAILED = "failed"
    BLOCKED = "blocked"
    SKIPPED = "skipped"
    # Additional types for graph-level events
    JOB_STARTED = "job_started"
    JOB_COMPLETED = "job_completed"
    JOB_FAILED = "job_failed"


class Graph(Base):
    """
    Stores the full TaskGraph JSON and metadata.
    Created when web app generates a graph.
    """
    __tablename__ = "graphs"

    graph_id = Column(String(36), primary_key=True)  # UUID
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Core data
    user_request = Column(Text, nullable=False)
    taskgraph_json = Column(JSON, nullable=False)  # Full TaskGraph per PRD spec
    
    # Slider presets (cached for reference)
    verbosity = Column(String(10), default="medium")  # low, medium, high
    autonomy = Column(String(10), default="medium")   # low (ask), high (assume)
    risk_tolerance = Column(String(10), default="safe")  # safe, aggressive
    
    # Status summary
    total_nodes = Column(Integer, default=0)
    completed_nodes = Column(Integer, default=0)
    failed_nodes = Column(Integer, default=0)
    
    # TTL cleanup (demo: 24 hours)
    expires_at = Column(DateTime, nullable=True)
    
    # Relationships
    jobs = relationship("Job", back_populates="graph", cascade="all, delete-orphan")
    events = relationship("Event", back_populates="graph", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_graphs_created_at", "created_at"),
        Index("ix_graphs_expires_at", "expires_at"),
    )


class Job(Base):
    """
    Job queue entry. One job per graph.
    Invene polls for pending jobs and claims them.
    """
    __tablename__ = "jobs"

    job_id = Column(String(36), primary_key=True)  # UUID
    graph_id = Column(String(36), ForeignKey("graphs.graph_id"), nullable=False)
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    claimed_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    status = Column(Enum(JobStatus), default=JobStatus.PENDING, nullable=False)
    
    # Which Invene instance claimed this (for multi-instance future)
    claimed_by = Column(String(64), nullable=True)
    
    # Current execution state
    current_node_id = Column(String(64), nullable=True)
    current_node_index = Column(Integer, default=0)
    
    # Error info if failed
    error_message = Column(Text, nullable=True)
    
    # Relationships
    graph = relationship("Graph", back_populates="jobs")

    __table_args__ = (
        Index("ix_jobs_status", "status"),
        Index("ix_jobs_graph_id", "graph_id"),
    )


class Event(Base):
    """
    Append-only execution events from Invene.
    Per PRD ExecutionEvent spec.
    """
    __tablename__ = "events"

    event_id = Column(Integer, primary_key=True, autoincrement=True)
    graph_id = Column(String(36), ForeignKey("graphs.graph_id"), nullable=False)
    node_id = Column(String(64), nullable=True)  # Null for job-level events
    
    event_type = Column(Enum(EventType), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Human-readable status message
    message = Column(Text, nullable=True)
    
    # Artifacts (JSON array per PRD)
    # [{ type: "log_summary"|"plan"|"patch"|..., content_ref: str }]
    artifacts = Column(JSON, nullable=True)
    
    # Metrics (optional)
    # { duration_ms, iterations_used, token_estimate }
    metrics = Column(JSON, nullable=True)
    
    # Relationships
    graph = relationship("Graph", back_populates="events")

    __table_args__ = (
        Index("ix_events_graph_id", "graph_id"),
        Index("ix_events_graph_node", "graph_id", "node_id"),
        Index("ix_events_timestamp", "timestamp"),
    )
