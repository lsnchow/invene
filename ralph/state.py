"""
Ralph Loop State Model - Persistent, deterministic state for each loop.

State is never discarded; memory is append-only.
Superseded knowledge is marked, never deleted.
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime
import json


class DecisionType(Enum):
    """Types of decisions the loop can make."""
    CONTINUE = "continue"
    CHANGE_STRATEGY = "change_strategy"
    ASK_CLARIFICATION = "ask_clarification"
    STOP_SUCCESS = "stop_success"
    STOP_FAILURE = "stop_failure"
    STOP_MAX_ITERATIONS = "stop_max_iterations"
    STOP_LOW_CONFIDENCE = "stop_low_confidence"
    STOP_USER_INTERRUPT = "stop_user_interrupt"


class FactType(Enum):
    """Types of facts that can be recorded."""
    OBSERVATION = "observation"
    ERROR = "error"
    CONTRADICTION = "contradiction"
    ASSUMPTION = "assumption"
    CONSTRAINT = "constraint"
    OPEN_QUESTION = "open_question"


@dataclass
class Fact:
    """A structured piece of knowledge derived from observation."""
    type: FactType
    content: str
    source: str  # Which iteration/phase produced this
    confidence: float = 1.0  # 0.0 to 1.0
    superseded: bool = False
    superseded_by: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "content": self.content,
            "source": self.source,
            "confidence": self.confidence,
            "superseded": self.superseded,
            "superseded_by": self.superseded_by,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass  
class Attempt:
    """Record of a single action attempted."""
    iteration: int
    action_type: str
    action_detail: str
    outcome: str  # "success", "failure", "timeout", "partial"
    result: Optional[str] = None
    failure_reason: Optional[str] = None
    avoidance_hint: Optional[str] = None  # How to avoid repeating
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "iteration": self.iteration,
            "action_type": self.action_type,
            "action_detail": self.action_detail,
            "outcome": self.outcome,
            "result": self.result,
            "failure_reason": self.failure_reason,
            "avoidance_hint": self.avoidance_hint,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class Decision:
    """The result of the Decide phase."""
    type: DecisionType
    reasoning: str
    next_action: Optional[str] = None
    confidence: float = 1.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "reasoning": self.reasoning,
            "next_action": self.next_action,
            "confidence": self.confidence,
        }


@dataclass
class LoopState:
    """
    Complete state of a Ralph Loop.
    Append-only: superseded knowledge is marked, never deleted.
    """
    # Identity
    loop_id: str
    created_at: datetime = field(default_factory=datetime.now)
    
    # Objective
    objective: str = ""
    constraints: List[str] = field(default_factory=list)
    
    # Knowledge (append-only)
    facts: List[Fact] = field(default_factory=list)
    attempts: List[Attempt] = field(default_factory=list)
    avoid_list: List[str] = field(default_factory=list)
    pending_questions: List[str] = field(default_factory=list)
    
    # Current state
    iteration: int = 0
    current_plan: Optional[str] = None
    last_observation: Optional[str] = None
    last_decision: Optional[Decision] = None
    
    # Metrics
    confidence: float = 1.0
    consecutive_failures: int = 0
    
    # Status
    stopped: bool = False
    stop_reason: Optional[str] = None
    final_summary: Optional[str] = None
    
    def add_fact(self, fact: Fact) -> None:
        """Add a fact to knowledge base."""
        self.facts.append(fact)
    
    def add_attempt(self, attempt: Attempt) -> None:
        """Record an attempt."""
        self.attempts.append(attempt)
        if attempt.outcome == "failure":
            self.consecutive_failures += 1
            if attempt.avoidance_hint:
                self.avoid_list.append(attempt.avoidance_hint)
        else:
            self.consecutive_failures = 0
    
    def supersede_fact(self, old_fact: Fact, new_content: str, source: str) -> Fact:
        """Mark a fact as superseded and add the new version."""
        old_fact.superseded = True
        old_fact.superseded_by = source
        new_fact = Fact(
            type=old_fact.type,
            content=new_content,
            source=source,
            confidence=old_fact.confidence,
        )
        self.facts.append(new_fact)
        return new_fact
    
    def get_active_facts(self) -> List[Fact]:
        """Get all non-superseded facts."""
        return [f for f in self.facts if not f.superseded]
    
    def get_failed_attempts(self) -> List[Attempt]:
        """Get all failed attempts for avoidance."""
        return [a for a in self.attempts if a.outcome == "failure"]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "loop_id": self.loop_id,
            "created_at": self.created_at.isoformat(),
            "objective": self.objective,
            "constraints": self.constraints,
            "facts": [f.to_dict() for f in self.facts],
            "attempts": [a.to_dict() for a in self.attempts],
            "avoid_list": self.avoid_list,
            "pending_questions": self.pending_questions,
            "iteration": self.iteration,
            "current_plan": self.current_plan,
            "confidence": self.confidence,
            "consecutive_failures": self.consecutive_failures,
            "stopped": self.stopped,
            "stop_reason": self.stop_reason,
            "final_summary": self.final_summary,
        }
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)
