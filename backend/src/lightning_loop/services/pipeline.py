"""Autonomous 8-stage pipeline for Lightning Loop."""
import asyncio
from typing import AsyncGenerator, Any, Literal
from dataclasses import dataclass

from lightning_loop.backboard.client import backboard
from lightning_loop.backboard.memory import MemoryManager, MemoryContext


PipelineStage = Literal[
    'observation',
    'intent', 
    'decomposition',
    'strategy',
    'compilation',
    'injection',
    'outcome',
    'decision'
]

STAGES: list[PipelineStage] = [
    'observation',
    'intent',
    'decomposition',
    'strategy',
    'compilation',
    'injection',
    'outcome',
    'decision'
]


@dataclass
class PipelineState:
    """State carried through pipeline stages."""
    user_input: str
    iteration: int = 1
    
    # Observation stage outputs
    raw_text: str = ""
    detected_errors: list[str] = None
    detected_goals: list[str] = None
    
    # Intent stage outputs
    intent_type: str = ""
    confidence: float = 0.0
    
    # Decomposition stage outputs
    tasks: list[str] = None
    constraints: list[str] = None
    success_criteria: list[str] = None
    
    # Strategy stage outputs
    chosen_strategy: str = ""
    rejected_strategies: list[str] = None
    
    # Compilation stage outputs
    execution_prompt: str = ""
    token_estimate: int = 0
    
    # Injection stage outputs
    injection_status: str = ""
    
    # Outcome stage outputs
    outcome: str = ""  # success, partial, failure
    outcome_signals: list[str] = None
    
    # Decision stage outputs
    next_action: str = ""  # continue, switch_strategy, stop, clarify
    should_continue: bool = False
    
    def __post_init__(self):
        self.detected_errors = self.detected_errors or []
        self.detected_goals = self.detected_goals or []
        self.tasks = self.tasks or []
        self.constraints = self.constraints or []
        self.success_criteria = self.success_criteria or []
        self.rejected_strategies = self.rejected_strategies or []
        self.outcome_signals = self.outcome_signals or []


class Pipeline:
    """Autonomous 8-stage execution pipeline."""
    
    MAX_ITERATIONS = 5
    
    SYSTEM_PROMPTS = {
        'observation': """You are an observation module. Extract facts from the input.
Output JSON: {"raw_text": "...", "detected_errors": [...], "detected_goals": [...]}
Only extract facts. Do not reason or plan.""",

        'intent': """You are an intent classifier. Determine user intent.
Intent types: fix_bug, make_tests_pass, refactor, explain, build_feature, ambiguous
Output JSON: {"intent_type": "...", "confidence": 0.0-1.0}""",

        'decomposition': """You are a task decomposer. Break the intent into executable steps.
Output JSON: {"tasks": [...], "constraints": [...], "success_criteria": [...]}""",

        'strategy': """You are a strategy selector. Choose the best approach.
Consider the avoid list of failed strategies.
Output JSON: {"chosen_strategy": "...", "rejected_strategies": [...], "reason": "..."}""",

        'compilation': """You are a prompt compiler. Create an execution-ready prompt for a coding assistant.
The prompt should be structured, clear, and actionable.
Output the prompt directly, not as JSON.""",

        'decision': """You are a decision module. Analyze the outcome and decide next action.
Actions: continue (next iteration), switch_strategy, stop (success), clarify (need input)
Output JSON: {"next_action": "...", "reason": "...", "should_continue": true/false}"""
    }

    async def run(
        self, 
        user_input: str,
        memory_manager: MemoryManager
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Run the full pipeline, yielding SSE events."""
        
        state = PipelineState(user_input=user_input)
        memory_context = await memory_manager.get_relevant_memory(user_input, "unknown")
        
        iteration = 1
        
        while iteration <= self.MAX_ITERATIONS:
            state.iteration = iteration
            
            yield {"type": "iteration_start", "iteration": iteration}
            
            for stage in STAGES:
                # Emit stage start
                yield {"type": "stage_start", "stage": stage, "iteration": iteration}
                
                try:
                    # Run the stage
                    detail = await self._run_stage(stage, state, memory_context)
                    
                    # Emit stage complete
                    yield {
                        "type": "stage_complete", 
                        "stage": stage, 
                        "iteration": iteration,
                        "detail": detail
                    }
                    
                except Exception as e:
                    yield {
                        "type": "stage_failed",
                        "stage": stage,
                        "iteration": iteration,
                        "error": str(e)
                    }
                    # Continue to decision stage on failure
                    if stage != 'decision':
                        state.outcome = 'failure'
                        state.outcome_signals.append(f"Stage {stage} failed: {str(e)}")
            
            yield {"type": "iteration_complete", "iteration": iteration}
            
            # Check if we should continue
            if not state.should_continue:
                break
                
            iteration += 1
        
        # Final result
        result = self._build_final_result(state)
        yield {"type": "loop_complete", "result": result}
    
    async def _run_stage(
        self, 
        stage: PipelineStage, 
        state: PipelineState,
        memory_context: MemoryContext
    ) -> str:
        """Run a single pipeline stage."""
        
        if stage == 'observation':
            return await self._run_observation(state)
        elif stage == 'intent':
            return await self._run_intent(state)
        elif stage == 'decomposition':
            return await self._run_decomposition(state)
        elif stage == 'strategy':
            return await self._run_strategy(state, memory_context)
        elif stage == 'compilation':
            return await self._run_compilation(state)
        elif stage == 'injection':
            return await self._run_injection(state)
        elif stage == 'outcome':
            return await self._run_outcome(state)
        elif stage == 'decision':
            return await self._run_decision(state)
        
        return ""
    
    async def _run_observation(self, state: PipelineState) -> str:
        """Observation stage: capture current system state."""
        state.raw_text = state.user_input
        
        # Simple error detection
        error_keywords = ['error', 'exception', 'failed', 'traceback', 'undefined', 'null']
        state.detected_errors = [
            line for line in state.user_input.lower().split('\n')
            if any(kw in line for kw in error_keywords)
        ][:5]
        
        # Simple goal detection
        goal_keywords = ['fix', 'make', 'create', 'build', 'refactor', 'explain', 'why']
        for kw in goal_keywords:
            if kw in state.user_input.lower():
                state.detected_goals.append(f"User wants to {kw}")
        
        return f"Found {len(state.detected_errors)} potential errors, {len(state.detected_goals)} goals"
    
    async def _run_intent(self, state: PipelineState) -> str:
        """Intent classification stage."""
        input_lower = state.user_input.lower()
        
        # Simple intent classification
        if 'fix' in input_lower or 'error' in input_lower or 'bug' in input_lower:
            state.intent_type = 'fix_bug'
            state.confidence = 0.9
        elif 'test' in input_lower and ('pass' in input_lower or 'fail' in input_lower):
            state.intent_type = 'make_tests_pass'
            state.confidence = 0.85
        elif 'refactor' in input_lower:
            state.intent_type = 'refactor'
            state.confidence = 0.9
        elif 'explain' in input_lower or 'why' in input_lower:
            state.intent_type = 'explain'
            state.confidence = 0.8
        elif 'build' in input_lower or 'create' in input_lower or 'add' in input_lower:
            state.intent_type = 'build_feature'
            state.confidence = 0.75
        else:
            state.intent_type = 'fix_bug'  # Default
            state.confidence = 0.5
        
        return f"Intent: {state.intent_type} (confidence: {state.confidence:.0%})"
    
    async def _run_decomposition(self, state: PipelineState) -> str:
        """Task decomposition stage."""
        
        if state.intent_type == 'fix_bug':
            state.tasks = [
                "Identify the root cause of the error",
                "Locate the relevant code section",
                "Apply minimal fix",
                "Verify fix resolves the error"
            ]
            state.success_criteria = ["Error no longer occurs", "No new errors introduced"]
        elif state.intent_type == 'make_tests_pass':
            state.tasks = [
                "Parse test failure output",
                "Identify failing assertions",
                "Fix code to match expected behavior",
                "Re-run tests to verify"
            ]
            state.success_criteria = ["All tests pass", "No regressions"]
        elif state.intent_type == 'refactor':
            state.tasks = [
                "Identify code to refactor",
                "Preserve existing behavior",
                "Apply refactoring pattern",
                "Verify functionality unchanged"
            ]
            state.success_criteria = ["Code improved", "Behavior unchanged"]
        elif state.intent_type == 'explain':
            state.tasks = [
                "Analyze the error or behavior",
                "Identify contributing factors",
                "Generate clear explanation"
            ]
            state.success_criteria = ["Explanation is clear and accurate"]
        else:
            state.tasks = [
                "Understand requirements",
                "Design solution",
                "Implement changes",
                "Test implementation"
            ]
            state.success_criteria = ["Requirements met"]
        
        return f"{len(state.tasks)} tasks identified"
    
    async def _run_strategy(self, state: PipelineState, memory_context: MemoryContext) -> str:
        """Strategy selection stage."""
        
        # Get avoid list from memory
        avoid_list = memory_context.avoid_list
        
        strategies = {
            'fix_bug': ['direct_fix', 'rollback_and_fix', 'workaround'],
            'make_tests_pass': ['fix_implementation', 'fix_test', 'mock_dependency'],
            'refactor': ['extract_method', 'rename', 'simplify'],
            'explain': ['trace_execution', 'analyze_types', 'check_assumptions'],
            'build_feature': ['incremental', 'scaffold_first', 'test_driven'],
        }
        
        available = strategies.get(state.intent_type, ['default'])
        
        # Filter out avoided strategies
        for strategy in available:
            if strategy not in avoid_list:
                state.chosen_strategy = strategy
                break
        else:
            state.chosen_strategy = available[0]  # Fallback
        
        state.rejected_strategies = [s for s in available if s != state.chosen_strategy]
        
        return f"Strategy: {state.chosen_strategy}"
    
    async def _run_compilation(self, state: PipelineState) -> str:
        """Compile execution prompt for coding assistant."""
        
        prompt_parts = [
            f"## Objective",
            f"{state.intent_type.replace('_', ' ').title()}: {state.user_input[:200]}",
            "",
            f"## Strategy",
            f"{state.chosen_strategy.replace('_', ' ').title()}",
            "",
            f"## Tasks",
        ]
        
        for i, task in enumerate(state.tasks, 1):
            prompt_parts.append(f"{i}. {task}")
        
        prompt_parts.extend([
            "",
            f"## Constraints",
            "- Make minimal changes",
            "- Preserve existing behavior where not explicitly changing",
            "- Follow existing code style",
        ])
        
        for constraint in state.constraints:
            prompt_parts.append(f"- {constraint}")
        
        prompt_parts.extend([
            "",
            f"## Success Criteria",
        ])
        
        for criterion in state.success_criteria:
            prompt_parts.append(f"- {criterion}")
        
        if state.detected_errors:
            prompt_parts.extend([
                "",
                f"## Error Context",
            ])
            for error in state.detected_errors[:3]:
                prompt_parts.append(f"```\n{error}\n```")
        
        state.execution_prompt = "\n".join(prompt_parts)
        state.token_estimate = len(state.execution_prompt) // 4
        
        return f"Prompt compiled ({state.token_estimate} tokens)"
    
    async def _run_injection(self, state: PipelineState) -> str:
        """Inject prompt into editor."""
        
        # For now, we'll mark this as ready for injection
        # The actual injection happens via the Electron IPC
        state.injection_status = "ready"
        
        # In a full implementation, this would:
        # 1. Focus the target editor (VS Code/Cursor)
        # 2. Open the copilot chat
        # 3. Paste the prompt
        # 4. Optionally trigger execution
        
        return f"Prompt ready for injection ({len(state.execution_prompt)} chars)"
    
    async def _run_outcome(self, state: PipelineState) -> str:
        """Observe outcome of execution."""
        
        # For MVP, we'll simulate success since we can't yet capture editor feedback
        # In full implementation, this would:
        # 1. Wait for editor changes
        # 2. Capture terminal output
        # 3. Run tests if applicable
        # 4. Analyze results
        
        # Simulate based on iteration
        if state.iteration == 1:
            state.outcome = "partial"
            state.outcome_signals = ["Prompt injected", "Awaiting editor feedback"]
        else:
            state.outcome = "success"
            state.outcome_signals = ["Changes applied"]
        
        return f"Outcome: {state.outcome}"
    
    async def _run_decision(self, state: PipelineState) -> str:
        """Decide next action."""
        
        if state.outcome == "success":
            state.next_action = "stop"
            state.should_continue = False
            return "Success - stopping loop"
        elif state.outcome == "failure" and state.iteration >= 3:
            state.next_action = "stop"
            state.should_continue = False
            return "Max retries reached - stopping"
        elif state.outcome == "failure":
            state.next_action = "switch_strategy"
            state.should_continue = True
            return "Switching strategy for next iteration"
        else:  # partial
            state.next_action = "stop"  # For MVP, stop after first iteration
            state.should_continue = False
            return "Prompt ready - awaiting manual execution"
    
    def _build_final_result(self, state: PipelineState) -> str:
        """Build final result message."""
        if state.outcome == "success":
            return "✓ Task completed successfully"
        elif state.next_action == "stop" and state.execution_prompt:
            return f"Prompt ready. Copy to your editor to apply changes."
        else:
            return f"Completed {state.iteration} iteration(s). Last outcome: {state.outcome}"
