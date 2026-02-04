"""Memory management using Backboard."""
import json
from typing import Any, Literal
from dataclasses import dataclass, field, asdict

from lightning_loop.backboard.client import backboard


@dataclass
class MemoryRecord:
    """A memory record stored in Backboard."""
    type: str  # failure, success, constraint
    content: str
    tags: list[str]
    confidence: float
    source_iteration_id: str
    error_signature: str = ""  # For matching similar errors
    

@dataclass
class MemoryContext:
    """Context retrieved from memory for a loop iteration."""
    failures: list[dict] = field(default_factory=list)
    successes: list[dict] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    avoid_list: list[str] = field(default_factory=list)


class MemoryManager:
    """Manages loop memory using Backboard."""
    
    SYSTEM_PROMPT = """You are a memory management assistant for Lightning Loop, a debug loop tool.
Your job is to:
1. Store and retrieve failure/success records
2. Generate avoid lists from past failures
3. Find relevant past fixes for similar errors

Always respond with valid JSON."""

    def __init__(self):
        self._local_memory: dict[str, list[MemoryRecord]] = {
            "failures": [],
            "successes": [],
            "constraints": [],
        }
    
    def _extract_error_signature(self, error_output: str) -> str:
        """Extract a signature from error output for matching."""
        lines = error_output.strip().split("\n")
        # Get the last error line (usually contains the actual error)
        for line in reversed(lines):
            line = line.strip()
            if line and ("error" in line.lower() or "exception" in line.lower()):
                # Remove line numbers and file paths for matching
                import re
                signature = re.sub(r'line \d+', 'line N', line)
                signature = re.sub(r'File "[^"]+",', 'File "...",', signature)
                return signature[:200]
        return lines[-1][:200] if lines else ""
    
    async def get_relevant_memory(
        self,
        error_output: str,
        language: str,
    ) -> MemoryContext:
        """Get relevant memory for the current error."""
        error_signature = self._extract_error_signature(error_output)
        
        # Find similar failures to avoid
        avoid_list = []
        for failure in self._local_memory["failures"]:
            if failure.error_signature and error_signature:
                # Simple similarity check
                if failure.error_signature in error_signature or error_signature in failure.error_signature:
                    avoid_list.append(failure.content)
        
        # Find successful fixes for similar errors
        successes = []
        for success in self._local_memory["successes"]:
            if success.error_signature and error_signature:
                if success.error_signature in error_signature or error_signature in success.error_signature:
                    successes.append(asdict(success))
        
        return MemoryContext(
            failures=[asdict(f) for f in self._local_memory["failures"][-10:]],
            successes=successes,
            constraints=self._local_memory["constraints"][-5:] if self._local_memory["constraints"] else [],
            avoid_list=avoid_list,
        )
    
    async def record_validation(
        self,
        iteration_id: str,
        status: Literal["success", "failure"],
        feedback: str,
    ):
        """Record the validation result of an iteration."""
        # This would typically be called with more context
        # For now, just store the basic record
        record = MemoryRecord(
            type=status,
            content=feedback or f"Iteration {iteration_id} marked as {status}",
            tags=[status, iteration_id],
            confidence=1.0,
            source_iteration_id=iteration_id,
        )
        
        if status == "failure":
            self._local_memory["failures"].append(record)
        else:
            self._local_memory["successes"].append(record)
        
        # Optionally persist to Backboard with conversation memory
        if backboard.is_configured:
            try:
                await backboard.send_message(
                    session_key="memory",
                    content=f"Store {status} record: {feedback}",
                    system_prompt=self.SYSTEM_PROMPT,
                    memory="Auto",
                )
            except Exception as e:
                print(f"Warning: Failed to persist to Backboard: {e}")
    
    async def record_iteration(
        self,
        iteration_id: str,
        error_output: str,
        proposed_fix: str,
        language: str,
    ):
        """Record an iteration attempt."""
        error_signature = self._extract_error_signature(error_output)
        
        record = MemoryRecord(
            type="attempt",
            content=proposed_fix,
            tags=[language, iteration_id],
            confidence=0.5,  # Neutral until validated
            source_iteration_id=iteration_id,
            error_signature=error_signature,
        )
        
        # Store temporarily until validation
        # Will be moved to success/failure based on validation
        pass
    
    async def get_avoid_list(self) -> list[str]:
        """Get list of failed fixes to avoid."""
        return [f.content for f in self._local_memory["failures"]]
    
    async def add_constraint(self, constraint: str):
        """Add a constraint to memory."""
        record = MemoryRecord(
            type="constraint",
            content=constraint,
            tags=["constraint"],
            confidence=1.0,
            source_iteration_id="manual",
        )
        self._local_memory["constraints"].append(record)
