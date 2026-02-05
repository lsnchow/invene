"""
Ralph Loops - Core Execution and Reasoning Engine for Invene

A disciplined, memory-driven execution loop that turns brittle AI automation
into a coherent, explainable system.
"""

from ralph.state import LoopState, Fact, Attempt, Decision, DecisionType, FactType
from ralph.memory import Memory, MemoryEntry, EntryType
from ralph.actuators import Actuator, CopilotActuator, TerminalActuator, ActionResult, ActionOutcome
from ralph.loop import RalphLoop, LoopConfig, IterationNarrative, create_copilot_loop

__all__ = [
    # Core loop
    "RalphLoop",
    "LoopConfig",
    "IterationNarrative",
    "create_copilot_loop",
    # State
    "LoopState",
    "Fact",
    "Attempt",
    "Decision",
    "DecisionType",
    "FactType",
    # Memory
    "Memory",
    "MemoryEntry",
    "EntryType",
    # Actuators
    "Actuator",
    "CopilotActuator",
    "TerminalActuator",
    "ActionResult",
    "ActionOutcome",
]
