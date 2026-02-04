"""Loop engine - core debug loop logic."""
import json
import re
from typing import Any, Literal

from lightning_loop.backboard.client import backboard
from lightning_loop.backboard.memory import MemoryContext


ANALYSIS_SYSTEM_PROMPT = """You are an expert debugging assistant. Analyze error outputs and propose minimal, targeted fixes.

Your responses must be valid JSON with this structure:
{
  "root_cause": "One sentence describing the root cause",
  "observations": ["observation 1", "observation 2"],
  "plan": "Step by step fix plan",
  "patch_strategy": "Brief description of what code changes to make"
}

Be concise. Focus on the actual error, not general advice."""


PROMPT_TEMPLATE = """## Objective
{objective}

## Environment
- Language: {language}
- Project: {project_path}

## Error Output
```
{error_output}
```

## Root Cause Analysis
{root_cause}

## Constraints
{constraints}

## Things to Avoid
{avoid_list}

## Fix Plan
{plan}

## Patch Strategy
{patch_strategy}

## Acceptance Criteria
- The original error should not occur
- No new errors introduced
- Minimal changes to existing code
"""


class LoopEngine:
    """Engine for running debug loop iterations."""
    
    MODE_OBJECTIVES = {
        "fix-error": "Fix the error shown below with minimal code changes",
        "make-tests-pass": "Make the failing tests pass without breaking other tests",
        "refactor": "Refactor the code while preserving existing behavior",
        "explain": "Explain why this error occurred and how to prevent it",
    }
    
    async def run(
        self,
        mode: Literal["fix-error", "make-tests-pass", "refactor", "explain"],
        error_output: str,
        context: str,
        language: str,
        project_path: str,
        memory_context: MemoryContext,
        previous_iterations: list[str],
    ) -> dict[str, Any]:
        """Run a loop iteration."""
        
        # Build analysis prompt
        analysis_prompt = f"""Analyze this {language} error and provide a fix plan.

Error output:
```
{error_output}
```

Additional context:
{context if context else "None provided"}

Previous failed fixes to AVOID:
{chr(10).join(f'- {a}' for a in memory_context.avoid_list) if memory_context.avoid_list else "None"}

Respond with JSON only."""

        # Get analysis from Backboard
        analysis = await self._get_analysis(analysis_prompt)
        
        # Calculate token metrics
        naive_prompt = f"Fix this error:\n{error_output}\n{context}"
        naive_tokens = len(naive_prompt) // 4
        
        # Build optimized prompt
        optimized_prompt = PROMPT_TEMPLATE.format(
            objective=self.MODE_OBJECTIVES.get(mode, "Fix the error"),
            language=language,
            project_path=project_path or "Not specified",
            error_output=error_output[:2000],  # Truncate for token savings
            root_cause=analysis.get("root_cause", "Unknown"),
            constraints="\n".join(f"- {c}" for c in memory_context.constraints) if memory_context.constraints else "None",
            avoid_list="\n".join(f"- {a}" for a in memory_context.avoid_list[:5]) if memory_context.avoid_list else "None",
            plan=analysis.get("plan", "Analyze and fix the error"),
            patch_strategy=analysis.get("patch_strategy", "Apply minimal fix"),
        )
        
        optimized_tokens = len(optimized_prompt) // 4
        saved_tokens = max(0, naive_tokens - optimized_tokens)
        
        # Build graph nodes
        graph_nodes, graph_edges = self._build_graph(analysis, memory_context)
        
        return {
            "root_cause": analysis.get("root_cause", "Unknown"),
            "observations": analysis.get("observations", []),
            "plan": analysis.get("plan", ""),
            "patch_strategy": analysis.get("patch_strategy", ""),
            "optimized_prompt": optimized_prompt,
            "naive_tokens": naive_tokens,
            "optimized_tokens": optimized_tokens,
            "saved_tokens": saved_tokens,
            "graph_nodes": graph_nodes,
            "graph_edges": graph_edges,
        }
    
    async def _get_analysis(self, prompt: str) -> dict[str, Any]:
        """Get analysis from Backboard or fallback to heuristics."""
        if backboard.is_configured:
            try:
                response = await backboard.one_shot(prompt, ANALYSIS_SYSTEM_PROMPT)
                return self._parse_json_response(response)
            except Exception as e:
                print(f"Backboard analysis failed: {e}")
        
        # Fallback to simple heuristics
        return self._heuristic_analysis(prompt)
    
    def _parse_json_response(self, response: str) -> dict[str, Any]:
        """Extract JSON from LLM response."""
        try:
            # Try direct parse
            return json.loads(response)
        except json.JSONDecodeError:
            pass
        
        # Try extracting from markdown code block
        if "```json" in response:
            json_str = response.split("```json")[1].split("```")[0]
            return json.loads(json_str.strip())
        elif "```" in response:
            json_str = response.split("```")[1].split("```")[0]
            return json.loads(json_str.strip())
        
        # Try finding inline JSON
        try:
            start = response.index("{")
            end = response.rindex("}") + 1
            return json.loads(response[start:end])
        except (ValueError, json.JSONDecodeError):
            pass
        
        # Return empty if all parsing fails
        return {}
    
    def _heuristic_analysis(self, prompt: str) -> dict[str, Any]:
        """Simple heuristic analysis when Backboard is not available."""
        error_patterns = {
            r"NameError.*'(\w+)'": lambda m: f"Variable '{m.group(1)}' is not defined",
            r"TypeError.*'(\w+)'.*'(\w+)'": lambda m: f"Type mismatch between {m.group(1)} and {m.group(2)}",
            r"SyntaxError": lambda m: "Syntax error in code",
            r"ImportError.*'(\w+)'": lambda m: f"Module '{m.group(1)}' not found",
            r"KeyError.*'(\w+)'": lambda m: f"Key '{m.group(1)}' not found in dictionary",
            r"AttributeError.*'(\w+)'.*'(\w+)'": lambda m: f"Object '{m.group(1)}' has no attribute '{m.group(2)}'",
            r"IndexError": lambda m: "Index out of range",
            r"FileNotFoundError": lambda m: "File or directory not found",
        }
        
        root_cause = "Unable to determine root cause automatically"
        for pattern, handler in error_patterns.items():
            match = re.search(pattern, prompt, re.IGNORECASE)
            if match:
                root_cause = handler(match)
                break
        
        return {
            "root_cause": root_cause,
            "observations": [
                "Error detected in code execution",
                "Stack trace analysis required",
            ],
            "plan": "1. Identify the line causing the error\n2. Understand the expected behavior\n3. Apply minimal fix",
            "patch_strategy": "Fix the specific line or function causing the error",
        }
    
    def _build_graph(
        self,
        analysis: dict[str, Any],
        memory_context: MemoryContext,
    ) -> tuple[list[dict], list[dict]]:
        """Build thinking graph nodes and edges."""
        nodes = [
            {
                "id": "input",
                "type": "input",
                "label": "Error Input",
                "content": "Error output received",
                "position": {"x": 200, "y": 0},
            },
            {
                "id": "obs",
                "type": "observation",
                "label": "Observations",
                "content": "; ".join(analysis.get("observations", [])[:2]),
                "position": {"x": 200, "y": 100},
            },
            {
                "id": "hyp",
                "type": "hypothesis",
                "label": "Root Cause",
                "content": analysis.get("root_cause", "Unknown"),
                "position": {"x": 200, "y": 200},
            },
            {
                "id": "fix",
                "type": "fix",
                "label": "Proposed Fix",
                "content": analysis.get("patch_strategy", ""),
                "position": {"x": 200, "y": 300},
            },
            {
                "id": "val",
                "type": "validation",
                "label": "Validation",
                "content": "Awaiting user feedback",
                "position": {"x": 200, "y": 400},
            },
        ]
        
        # Add memory node if there's relevant history
        if memory_context.avoid_list:
            nodes.insert(3, {
                "id": "mem",
                "type": "memory",
                "label": "Memory",
                "content": f"Avoiding {len(memory_context.avoid_list)} past failures",
                "position": {"x": 350, "y": 250},
            })
        
        edges = [
            {"id": "e1", "source": "input", "target": "obs"},
            {"id": "e2", "source": "obs", "target": "hyp"},
            {"id": "e3", "source": "hyp", "target": "fix"},
            {"id": "e4", "source": "fix", "target": "val"},
        ]
        
        if memory_context.avoid_list:
            edges.append({"id": "e5", "source": "mem", "target": "fix"})
        
        return nodes, edges
