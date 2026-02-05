"""Ralph Loop API routes with SSE streaming."""
import asyncio
import json
import logging
import sys
import os
from typing import AsyncGenerator, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Add parent to path for ralph imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))))

logger = logging.getLogger(__name__)

router = APIRouter()

# Store active Ralph loops
_active_loops: dict[str, dict] = {}


class RalphLoopRequest(BaseModel):
    """Request to start a Ralph loop."""
    objective: str
    actuator: str = "copilot"  # "copilot" or "terminal"
    max_iterations: int = 10
    constraints: Optional[list[str]] = None


class RalphStopRequest(BaseModel):
    """Request to stop a Ralph loop."""
    loop_id: str
    reason: str = "User requested stop"


def sse_event(data: dict) -> str:
    """Format data as SSE event."""
    return f"data: {json.dumps(data)}\n\n"


async def run_ralph_loop_stream(
    objective: str,
    actuator_type: str,
    max_iterations: int,
    constraints: Optional[list[str]] = None,
) -> AsyncGenerator[str, None]:
    """Run a Ralph loop and stream events via SSE."""
    
    try:
        from ralph import RalphLoop, LoopConfig, CopilotActuator, TerminalActuator
        from ralph.actuators import ActionOutcome
    except ImportError as e:
        logger.error(f"Failed to import ralph: {e}")
        yield sse_event({"type": "error", "message": f"Ralph not available: {e}"})
        return
    
    # Select actuator
    if actuator_type == "copilot":
        actuator = CopilotActuator()
    else:
        actuator = TerminalActuator()
    
    # Create loop with callbacks that emit SSE events
    loop_id = None
    event_queue: asyncio.Queue = asyncio.Queue()
    
    def on_iteration_start(iteration: int, state):
        event_queue.put_nowait({
            "type": "iteration_start",
            "iteration": iteration,
            "max_iterations": max_iterations,
            "objective": state.objective,
            "loop_id": state.loop_id,
        })
    
    def on_iteration_end(iteration: int, state):
        last_attempt = state.attempts[-1] if state.attempts else None
        last_decision = state.last_decision
        
        event_queue.put_nowait({
            "type": "iteration_end",
            "iteration": iteration,
            "outcome": last_attempt.outcome if last_attempt else None,
            "action": last_attempt.action_detail[:200] if last_attempt else None,
            "result": last_attempt.result[:500] if last_attempt and last_attempt.result else None,
            "decision": last_decision.type.value if last_decision else None,
            "decision_reasoning": last_decision.reasoning if last_decision else None,
            "confidence": state.confidence,
            "consecutive_failures": state.consecutive_failures,
        })
    
    def on_action(action: str, result):
        event_queue.put_nowait({
            "type": "action_result",
            "action": action[:200],
            "outcome": result.outcome.value,
            "output": result.output[:1000] if result.output else None,
            "error": result.error[:500] if result.error else None,
            "duration": result.duration,
        })
    
    def on_stop(state):
        event_queue.put_nowait({
            "type": "loop_complete",
            "loop_id": state.loop_id,
            "iterations": state.iteration,
            "stop_reason": state.stop_reason,
            "final_summary": state.final_summary,
        })
    
    config = LoopConfig(
        max_iterations=max_iterations,
        on_iteration_start=on_iteration_start,
        on_iteration_end=on_iteration_end,
        on_action=on_action,
        on_stop=on_stop,
    )
    
    loop = RalphLoop(
        objective=objective,
        actuator=actuator,
        config=config,
        constraints=constraints,
    )
    
    loop_id = loop.state.loop_id
    _active_loops[loop_id] = {"loop": loop, "running": True}
    
    # Emit start event
    yield sse_event({
        "type": "loop_start",
        "loop_id": loop_id,
        "objective": objective,
        "actuator": actuator_type,
        "max_iterations": max_iterations,
    })
    
    # Run loop in background task
    async def run_loop():
        try:
            # Run synchronously in thread pool
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                await asyncio.get_event_loop().run_in_executor(pool, loop.run)
        except Exception as e:
            event_queue.put_nowait({
                "type": "error",
                "message": str(e),
            })
        finally:
            event_queue.put_nowait({"type": "done"})
    
    # Start loop
    loop_task = asyncio.create_task(run_loop())
    
    # Stream events from queue
    try:
        while True:
            try:
                event = await asyncio.wait_for(event_queue.get(), timeout=1.0)
                yield sse_event(event)
                
                if event.get("type") == "done":
                    break
                    
            except asyncio.TimeoutError:
                # Send heartbeat
                yield sse_event({"type": "heartbeat"})
                
                # Check if loop is still running
                if loop_task.done():
                    break
                    
    except asyncio.CancelledError:
        loop.stop("Client disconnected")
        raise
    finally:
        _active_loops.pop(loop_id, None)


@router.post("/start")
async def start_ralph_loop(request: RalphLoopRequest):
    """Start a Ralph loop and stream events via SSE."""
    logger.info(f"Starting Ralph loop: {request.objective[:100]}...")
    
    return StreamingResponse(
        run_ralph_loop_stream(
            objective=request.objective,
            actuator_type=request.actuator,
            max_iterations=request.max_iterations,
            constraints=request.constraints,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/stop")
async def stop_ralph_loop(request: RalphStopRequest):
    """Stop a running Ralph loop."""
    if request.loop_id not in _active_loops:
        return {"success": False, "error": "Loop not found"}
    
    loop_data = _active_loops[request.loop_id]
    loop_data["loop"].stop(request.reason)
    
    return {"success": True, "loop_id": request.loop_id}


@router.get("/status")
async def get_ralph_status():
    """Get status of all active Ralph loops."""
    return {
        "active_loops": [
            {
                "loop_id": lid,
                "objective": data["loop"].state.objective,
                "iteration": data["loop"].state.iteration,
                "stopped": data["loop"].state.stopped,
            }
            for lid, data in _active_loops.items()
        ]
    }
