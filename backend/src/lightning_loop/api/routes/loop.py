"""Loop execution routes."""
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lightning_loop.services.loop_engine import LoopEngine
from lightning_loop.backboard.memory import MemoryManager

router = APIRouter()

# Initialize services
loop_engine = LoopEngine()
memory_manager = MemoryManager()


class LoopInput(BaseModel):
    """Input for a loop iteration."""
    errorOutput: str
    context: str = ""
    language: str = "python"
    projectPath: str = ""


class RunLoopRequest(BaseModel):
    """Request to run a loop iteration."""
    mode: Literal["fix-error", "make-tests-pass", "refactor", "explain"]
    input: LoopInput
    previous_iterations: list[str] = []


class Analysis(BaseModel):
    """Analysis result."""
    rootCause: str
    observations: list[str]


class Proposal(BaseModel):
    """Fix proposal."""
    plan: str
    patchStrategy: str
    optimizedPrompt: str


class Metrics(BaseModel):
    """Token metrics."""
    naiveTokens: int
    optimizedTokens: int
    savedTokens: int


class GraphNode(BaseModel):
    """Graph node."""
    id: str
    type: str
    label: str
    content: str
    position: dict


class GraphEdge(BaseModel):
    """Graph edge."""
    id: str
    source: str
    target: str


class RunLoopResponse(BaseModel):
    """Response from a loop iteration."""
    iteration_id: str
    analysis: Optional[Analysis]
    proposal: Optional[Proposal]
    metrics: Optional[Metrics]
    graph_nodes: list[GraphNode]
    graph_edges: list[GraphEdge]


class ValidateRequest(BaseModel):
    """Request to validate an iteration."""
    iteration_id: str
    status: Literal["success", "failure"]
    feedback: str = ""


@router.post("/run", response_model=RunLoopResponse)
async def run_loop(request: RunLoopRequest):
    """Run a loop iteration to analyze and generate fix."""
    try:
        iteration_id = str(uuid.uuid4())[:8]
        
        # Fetch relevant memory (failures to avoid, past fixes)
        memory_context = await memory_manager.get_relevant_memory(
            error_output=request.input.errorOutput,
            language=request.input.language,
        )
        
        # Run the loop engine
        result = await loop_engine.run(
            mode=request.mode,
            error_output=request.input.errorOutput,
            context=request.input.context,
            language=request.input.language,
            project_path=request.input.projectPath,
            memory_context=memory_context,
            previous_iterations=request.previous_iterations,
        )
        
        return RunLoopResponse(
            iteration_id=iteration_id,
            analysis=Analysis(
                rootCause=result.get("root_cause", "Unknown"),
                observations=result.get("observations", []),
            ),
            proposal=Proposal(
                plan=result.get("plan", ""),
                patchStrategy=result.get("patch_strategy", ""),
                optimizedPrompt=result.get("optimized_prompt", ""),
            ),
            metrics=Metrics(
                naiveTokens=result.get("naive_tokens", 0),
                optimizedTokens=result.get("optimized_tokens", 0),
                savedTokens=result.get("saved_tokens", 0),
            ),
            graph_nodes=result.get("graph_nodes", []),
            graph_edges=result.get("graph_edges", []),
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/validate")
async def validate_iteration(request: ValidateRequest):
    """Record validation result for an iteration."""
    try:
        await memory_manager.record_validation(
            iteration_id=request.iteration_id,
            status=request.status,
            feedback=request.feedback,
        )
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/memory/avoid-list")
async def get_avoid_list():
    """Get the list of failed fixes to avoid."""
    try:
        avoid_list = await memory_manager.get_avoid_list()
        return {"avoid_list": avoid_list}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
