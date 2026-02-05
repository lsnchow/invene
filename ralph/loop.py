"""
Ralph Loop - The core execution engine.

A closed feedback loop with persistent memory. Each iteration:
1. Observes reality
2. Normalizes observations into structured facts
3. Updates append-only memory
4. Plans exactly one next action
5. Executes that action
6. Waits for results
7. Decides whether and how to continue

Invariants:
- One iteration → one primary action
- Every iteration ends with a decision
- State is never discarded; memory is append-only
- Failure is first-class and explicitly recorded
- Control flow is centralized in the loop, never delegated
"""

from dataclasses import dataclass, field
from typing import Optional, Callable, List, Dict, Any
from datetime import datetime
import uuid
import time

from ralph.state import LoopState, Fact, Attempt, Decision, DecisionType, FactType
from ralph.memory import Memory, EntryType
from ralph.actuators import Actuator, ActionResult, ActionOutcome


@dataclass
class LoopConfig:
    """Configuration for a Ralph Loop."""
    max_iterations: int = 20
    confidence_threshold: float = 0.3
    max_consecutive_failures: int = 3
    iteration_delay: float = 0.5  # Pause between iterations
    
    # Callbacks
    on_iteration_start: Optional[Callable[[int, LoopState], None]] = None
    on_iteration_end: Optional[Callable[[int, LoopState], None]] = None
    on_action: Optional[Callable[[str, ActionResult], None]] = None
    on_stop: Optional[Callable[[LoopState], None]] = None


@dataclass
class IterationNarrative:
    """
    Structured narrative for transparency/auditing.
    
    Every iteration emits this to make long-running AI behavior
    inspectable and auditable.
    """
    iteration: int
    what_was_tried: str
    why_it_was_chosen: str
    what_happened: str
    what_comes_next: str
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_string(self) -> str:
        return f"""
[Iteration {self.iteration}]
TRIED: {self.what_was_tried}
WHY: {self.why_it_was_chosen}
RESULT: {self.what_happened}
NEXT: {self.what_comes_next}
""".strip()
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "iteration": self.iteration,
            "what_was_tried": self.what_was_tried,
            "why_it_was_chosen": self.why_it_was_chosen,
            "what_happened": self.what_happened,
            "what_comes_next": self.what_comes_next,
            "timestamp": self.timestamp.isoformat(),
        }


class RalphLoop:
    """
    The core Ralph Loop execution engine.
    
    The loop, not the tools, determines what happens next.
    """
    
    def __init__(
        self,
        objective: str,
        actuator: Actuator,
        config: Optional[LoopConfig] = None,
        planner: Optional[Callable[[LoopState, Memory], str]] = None,
        normalizer: Optional[Callable[[str, LoopState], List[Fact]]] = None,
        decider: Optional[Callable[[LoopState, ActionResult, Memory], Decision]] = None,
        constraints: Optional[List[str]] = None,
    ):
        self.config = config or LoopConfig()
        self.actuator = actuator
        
        # State and memory
        loop_id = f"ralph-{uuid.uuid4().hex[:8]}"
        self.state = LoopState(loop_id=loop_id, objective=objective)
        if constraints:
            self.state.constraints = constraints
        self.memory = Memory(loop_id)
        
        # Pluggable components (with defaults)
        self._planner = planner or self._default_planner
        self._normalizer = normalizer or self._default_normalizer
        self._decider = decider or self._default_decider
        
        # Narratives for transparency
        self.narratives: List[IterationNarrative] = []
    
    def run(self) -> LoopState:
        """
        Execute the loop until a stop condition is met.
        Returns the final state.
        """
        print("═" * 60)
        print(f"🔄 Ralph Loop: {self.state.loop_id}")
        print(f"📎 Objective: {self.state.objective}")
        if self.state.constraints:
            print(f"🔒 Constraints: {', '.join(self.state.constraints)}")
        print("═" * 60)
        
        while not self.state.stopped:
            self._run_iteration()
            
            if not self.state.stopped:
                time.sleep(self.config.iteration_delay)
        
        # Generate final summary
        self.state.final_summary = self._generate_summary()
        
        if self.config.on_stop:
            self.config.on_stop(self.state)
        
        print("\n" + "═" * 60)
        print(f"🏁 Loop complete: {self.state.stop_reason}")
        print(f"   Iterations: {self.state.iteration}")
        print("═" * 60)
        
        return self.state
    
    def run_single_iteration(self) -> LoopState:
        """Run exactly one iteration (useful for step-by-step debugging)."""
        if self.state.stopped:
            return self.state
        self._run_iteration()
        return self.state
    
    def stop(self, reason: str = "User interrupt") -> None:
        """Manually stop the loop."""
        self._stop(DecisionType.STOP_USER_INTERRUPT, reason)
    
    def _run_iteration(self) -> None:
        """Execute a single iteration through all 7 phases."""
        self.state.iteration += 1
        iteration = self.state.iteration
        
        print(f"\n{'─' * 40}")
        print(f"📍 Iteration {iteration}/{self.config.max_iterations}")
        print("─" * 40)
        
        if self.config.on_iteration_start:
            self.config.on_iteration_start(iteration, self.state)
        
        # Check iteration cap
        if iteration > self.config.max_iterations:
            self._stop(DecisionType.STOP_MAX_ITERATIONS, "Maximum iterations reached")
            return
        
        # ══════════════════════════════════════════════════════════════
        # PHASE 1: OBSERVE
        # Capture raw outputs exactly as they occurred. No reasoning.
        # ══════════════════════════════════════════════════════════════
        observation = self.state.last_observation or f"Starting: {self.state.objective}"
        self.memory.record_observation(iteration, observation)
        print(f"👁 Observe: {observation[:80]}{'...' if len(observation) > 80 else ''}")
        
        # ══════════════════════════════════════════════════════════════
        # PHASE 2: NORMALIZE
        # Convert observations into structured facts.
        # ══════════════════════════════════════════════════════════════
        facts = self._normalizer(observation, self.state)
        for fact in facts:
            self.state.add_fact(fact)
            self.memory.record_fact(iteration, fact.content, fact_type=fact.type.value)
        print(f"📋 Normalize: {len(facts)} facts")
        
        # ══════════════════════════════════════════════════════════════
        # PHASE 3: UPDATE MEMORY
        # Append new knowledge, update constraints.
        # (Memory updates happen automatically in record_* calls)
        # ══════════════════════════════════════════════════════════════
        
        # ══════════════════════════════════════════════════════════════
        # PHASE 4: PLAN
        # Generate and select exactly one action.
        # ══════════════════════════════════════════════════════════════
        action = self._planner(self.state, self.memory)
        self.state.current_plan = action
        self.memory.record_plan(iteration, action)
        print(f"📐 Plan: {action[:80]}{'...' if len(action) > 80 else ''}")
        
        # ══════════════════════════════════════════════════════════════
        # PHASE 5: EXECUTE
        # Dispatch action. No retries, no branching, no judgment.
        # ══════════════════════════════════════════════════════════════
        print(f"⚡ Execute via {self.actuator.name}...")
        self.memory.record_action(iteration, action, actuator=self.actuator.name)
        result = self.actuator.execute(action)
        
        if self.config.on_action:
            self.config.on_action(action, result)
        
        # ══════════════════════════════════════════════════════════════
        # PHASE 6: WAIT AND CAPTURE
        # Record completion status.
        # ══════════════════════════════════════════════════════════════
        result_content = result.output or result.error or "No output"
        self.memory.record_result(
            iteration, 
            result_content[:1000],
            outcome=result.outcome.value,
            duration=result.duration,
        )
        self.state.last_observation = result_content
        
        # Record attempt
        attempt = Attempt(
            iteration=iteration,
            action_type=self.actuator.name,
            action_detail=action[:500],
            outcome=result.outcome.value,
            result=result.output[:1000] if result.output else None,
            failure_reason=result.error,
            avoidance_hint=self._extract_avoidance_hint(result) if result.outcome == ActionOutcome.FAILURE else None,
        )
        self.state.add_attempt(attempt)
        
        outcome_symbol = {"success": "✓", "failure": "✗", "timeout": "⏱", "partial": "◐"}
        print(f"{outcome_symbol.get(result.outcome.value, '?')} Result: {result.outcome.value} ({result.duration:.1f}s)")
        
        # ══════════════════════════════════════════════════════════════
        # PHASE 7: DECIDE
        # Determine whether/how to continue.
        # ══════════════════════════════════════════════════════════════
        decision = self._decider(self.state, result, self.memory)
        self.state.last_decision = decision
        self.memory.record_decision(iteration, decision.reasoning, decision.type.value)
        
        print(f"🎯 Decision: {decision.type.value} - {decision.reasoning[:50]}...")
        
        # Record narrative for transparency
        narrative = IterationNarrative(
            iteration=iteration,
            what_was_tried=action[:200],
            why_it_was_chosen=self.state.current_plan[:200] if self.state.current_plan else "Initial action",
            what_happened=f"{result.outcome.value}: {result_content[:200]}",
            what_comes_next=decision.reasoning[:200],
        )
        self.narratives.append(narrative)
        
        # Act on decision
        if decision.type in (
            DecisionType.STOP_SUCCESS,
            DecisionType.STOP_FAILURE,
            DecisionType.STOP_MAX_ITERATIONS,
            DecisionType.STOP_LOW_CONFIDENCE,
            DecisionType.STOP_USER_INTERRUPT,
        ):
            self._stop(decision.type, decision.reasoning)
        
        if self.config.on_iteration_end:
            self.config.on_iteration_end(iteration, self.state)
    
    def _stop(self, reason: DecisionType, message: str) -> None:
        """Stop the loop with the given reason."""
        self.state.stopped = True
        self.state.stop_reason = f"{reason.value}: {message}"
    
    def _generate_summary(self) -> str:
        """Generate final human-readable summary."""
        lines = [
            f"═══ Ralph Loop Summary ═══",
            f"ID: {self.state.loop_id}",
            f"Objective: {self.state.objective}",
            f"Iterations: {self.state.iteration}",
            f"Outcome: {self.state.stop_reason}",
            "",
            "Attempts:",
        ]
        
        for attempt in self.state.attempts[-5:]:
            status = "✓" if attempt.outcome == "success" else "✗"
            lines.append(f"  {status} [{attempt.iteration}] {attempt.action_detail[:60]}...")
        
        errors = self.memory.get_errors()
        if errors:
            lines.append("")
            lines.append(f"Errors ({len(errors)}):")
            for e in errors[-3:]:
                lines.append(f"  - {e.content[:80]}")
        
        if self.state.avoid_list:
            lines.append("")
            lines.append("Avoid list:")
            for item in self.state.avoid_list[-5:]:
                lines.append(f"  - {item[:60]}")
        
        return "\n".join(lines)
    
    def _extract_avoidance_hint(self, result: ActionResult) -> Optional[str]:
        """Extract a hint for avoiding this failure in the future."""
        if not result.error:
            return None
        return f"Avoid: {result.error[:150]}"
    
    # ══════════════════════════════════════════════════════════════════
    # DEFAULT IMPLEMENTATIONS (Override with LLM-powered versions)
    # ══════════════════════════════════════════════════════════════════
    
    def _default_planner(self, state: LoopState, memory: Memory) -> str:
        """
        Default planner: uses objective and avoids previous failures.
        Override with a smarter LLM-based planner.
        """
        # First iteration: just use objective
        if state.iteration == 1:
            return state.objective
        
        # For terminal actuator: if first iteration succeeded, stop
        # (simple commands don't need follow-up)
        last_result = state.attempts[-1] if state.attempts else None
        if last_result and last_result.outcome == "success":
            # Signal success by returning a marker that the decider will catch
            return state.objective  # Re-run same command (decider will stop on success)
        
        # On failure, just retry the objective
        # A real planner would adapt the approach
        return state.objective
    
    def _default_normalizer(self, observation: str, state: LoopState) -> List[Fact]:
        """
        Default normalizer: creates a single observation fact.
        Override with a smarter parser.
        """
        return [Fact(
            type=FactType.OBSERVATION,
            content=observation[:1000],
            source=f"iteration-{state.iteration}",
        )]
    
    def _default_decider(self, state: LoopState, result: ActionResult, memory: Memory) -> Decision:
        """
        Default decider: checks stop conditions and decides next step.
        Override with a smarter LLM-based decider.
        """
        # Check confidence
        if state.confidence < self.config.confidence_threshold:
            return Decision(
                type=DecisionType.STOP_LOW_CONFIDENCE,
                reasoning=f"Confidence dropped to {state.confidence:.2f}",
            )
        
        # Check consecutive failures
        if state.consecutive_failures >= self.config.max_consecutive_failures:
            return Decision(
                type=DecisionType.STOP_FAILURE,
                reasoning=f"Failed {state.consecutive_failures} times consecutively",
            )
        
        # For simple commands: any success is good enough
        if result.outcome == ActionOutcome.SUCCESS:
            return Decision(
                type=DecisionType.STOP_SUCCESS,
                reasoning="Action completed successfully",
            )
        
        # Default: continue
        return Decision(
            type=DecisionType.CONTINUE,
            reasoning="No stop condition met, continuing",
            next_action=state.current_plan,
            confidence=state.confidence,
        )
    
    def get_narratives(self) -> List[IterationNarrative]:
        """Get all iteration narratives for transparency."""
        return self.narratives
    
    def print_narratives(self) -> None:
        """Print all narratives for debugging."""
        for n in self.narratives:
            print(n.to_string())
            print()


def create_copilot_loop(
    objective: str,
    config: Optional[LoopConfig] = None,
    constraints: Optional[List[str]] = None,
) -> RalphLoop:
    """
    Factory function to create a Ralph Loop with Copilot actuator.
    
    Example:
        loop = create_copilot_loop("Fix the TypeError in utils.py")
        result = loop.run()
    """
    from ralph.actuators import CopilotActuator
    
    return RalphLoop(
        objective=objective,
        actuator=CopilotActuator(),
        config=config,
        constraints=constraints,
    )


def create_terminal_loop(
    objective: str,
    cwd: str = None,
    config: Optional[LoopConfig] = None,
) -> RalphLoop:
    """
    Factory function to create a Ralph Loop with Terminal actuator.
    
    Example:
        loop = create_terminal_loop("Run tests and fix failures", cwd="/path/to/project")
        result = loop.run()
    """
    from ralph.actuators import TerminalActuator
    
    return RalphLoop(
        objective=objective,
        actuator=TerminalActuator(cwd=cwd),
        config=config,
    )
