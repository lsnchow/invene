"""
Ralph Loop Memory - Append-only persistent memory.

Philosophy:
- Memory is read at the start of each iteration.
- Memory is written at the end.
- Memory informs planning but never controls execution directly.
- Its role is to prevent repetition, improve decisions, and explain behavior.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum
import json
import hashlib


class EntryType(Enum):
    """Types of memory entries."""
    OBSERVATION = "observation"
    NORMALIZED_FACT = "normalized_fact"
    PLAN = "plan"
    ACTION = "action"
    RESULT = "result"
    DECISION = "decision"
    ERROR = "error"
    SUMMARY = "summary"


@dataclass
class MemoryEntry:
    """A single memory entry. Immutable once created."""
    type: EntryType
    iteration: int
    phase: str
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)
    hash: str = field(default="", init=False)
    
    def __post_init__(self):
        # Generate content hash for deduplication
        self.hash = hashlib.md5(
            f"{self.type.value}:{self.content}".encode()
        ).hexdigest()[:12]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "iteration": self.iteration,
            "phase": self.phase,
            "content": self.content,
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat(),
            "hash": self.hash,
        }


class Memory:
    """
    Append-only memory store for Ralph Loops.
    """
    
    def __init__(self, loop_id: str):
        self.loop_id = loop_id
        self.entries: List[MemoryEntry] = []
        self._seen_hashes: set = set()
    
    def append(self, entry: MemoryEntry) -> bool:
        """Append an entry to memory. Returns False if duplicate."""
        if entry.hash in self._seen_hashes:
            return False
        self._seen_hashes.add(entry.hash)
        self.entries.append(entry)
        return True
    
    def record_observation(self, iteration: int, content: str, **metadata) -> MemoryEntry:
        entry = MemoryEntry(
            type=EntryType.OBSERVATION,
            iteration=iteration,
            phase="observe",
            content=content,
            metadata=metadata,
        )
        self.append(entry)
        return entry
    
    def record_fact(self, iteration: int, content: str, **metadata) -> MemoryEntry:
        entry = MemoryEntry(
            type=EntryType.NORMALIZED_FACT,
            iteration=iteration,
            phase="normalize",
            content=content,
            metadata=metadata,
        )
        self.append(entry)
        return entry
    
    def record_plan(self, iteration: int, content: str, **metadata) -> MemoryEntry:
        entry = MemoryEntry(
            type=EntryType.PLAN,
            iteration=iteration,
            phase="plan",
            content=content,
            metadata=metadata,
        )
        self.append(entry)
        return entry
    
    def record_action(self, iteration: int, content: str, **metadata) -> MemoryEntry:
        entry = MemoryEntry(
            type=EntryType.ACTION,
            iteration=iteration,
            phase="execute",
            content=content,
            metadata=metadata,
        )
        self.append(entry)
        return entry
    
    def record_result(self, iteration: int, content: str, outcome: str, **metadata) -> MemoryEntry:
        entry = MemoryEntry(
            type=EntryType.RESULT,
            iteration=iteration,
            phase="wait_capture",
            content=content,
            metadata={"outcome": outcome, **metadata},
        )
        self.append(entry)
        return entry
    
    def record_decision(self, iteration: int, content: str, decision_type: str, **metadata) -> MemoryEntry:
        entry = MemoryEntry(
            type=EntryType.DECISION,
            iteration=iteration,
            phase="decide",
            content=content,
            metadata={"decision_type": decision_type, **metadata},
        )
        self.append(entry)
        return entry
    
    def record_error(self, iteration: int, content: str, **metadata) -> MemoryEntry:
        entry = MemoryEntry(
            type=EntryType.ERROR,
            iteration=iteration,
            phase="error",
            content=content,
            metadata=metadata,
        )
        self.append(entry)
        return entry
    
    def get_iteration(self, iteration: int) -> List[MemoryEntry]:
        """Get all entries for a specific iteration."""
        return [e for e in self.entries if e.iteration == iteration]
    
    def get_by_type(self, entry_type: EntryType) -> List[MemoryEntry]:
        """Get all entries of a specific type."""
        return [e for e in self.entries if e.type == entry_type]
    
    def get_errors(self) -> List[MemoryEntry]:
        """Get all error entries."""
        return self.get_by_type(EntryType.ERROR)
    
    def get_recent(self, n: int = 10) -> List[MemoryEntry]:
        """Get N most recent entries."""
        return self.entries[-n:]
    
    def summarize(self) -> str:
        """Generate a human-readable summary of memory."""
        lines = [f"Memory for loop {self.loop_id}:", f"Total entries: {len(self.entries)}"]
        
        by_type: Dict[str, int] = {}
        for e in self.entries:
            by_type[e.type.value] = by_type.get(e.type.value, 0) + 1
        
        for t, count in by_type.items():
            lines.append(f"  {t}: {count}")
        
        errors = self.get_errors()
        if errors:
            lines.append(f"\nErrors ({len(errors)}):")
            for e in errors[-3:]:
                lines.append(f"  - [{e.iteration}] {e.content[:80]}")
        
        return "\n".join(lines)
    
    def to_json(self) -> str:
        return json.dumps({
            "loop_id": self.loop_id,
            "entry_count": len(self.entries),
            "entries": [e.to_dict() for e in self.entries],
        }, indent=2)
