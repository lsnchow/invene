"""Pipeline execution routes with SSE streaming."""
import asyncio
import json
import logging
from typing import AsyncGenerator, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from lightning_loop.services.pipeline import Pipeline
from lightning_loop.services.product_pipeline import ProductPipeline, ProductState
from lightning_loop.services.intent import classify_intent, Intent
from lightning_loop.backboard.memory import MemoryManager

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter()

pipeline = Pipeline()
memory_manager = MemoryManager()

# Store active product sessions for revisions
_product_sessions: dict[str, ProductPipeline] = {}


class RunPipelineRequest(BaseModel):
    """Request to run the autonomous pipeline."""
    user_input: str


class DesignPipelineRequest(BaseModel):
    """Request to run the product design pipeline."""
    user_input: str
    session_id: Optional[str] = None  # For revisions
    is_revision: bool = False


def sse_event(data: dict) -> str:
    """Format data as SSE event."""
    return f"data: {json.dumps(data)}\n\n"


async def run_pipeline_stream(user_input: str) -> AsyncGenerator[str, None]:
    """Run pipeline and stream progress as SSE events."""
    logger.info(f"run_pipeline_stream called with: {user_input[:100]}...")
    
    try:
        async for event in pipeline.run(user_input, memory_manager):
            logger.debug(f"Pipeline event: {event.get('type')}")
            yield sse_event(event)
            
            # Small delay to allow frontend to process
            await asyncio.sleep(0.05)
            
    except Exception as e:
        logger.error(f"Pipeline stream error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        yield sse_event({
            "type": "stage_failed",
            "stage": "unknown",
            "error": str(e)
        })
        yield sse_event({
            "type": "loop_complete",
            "result": f"Error: {str(e)}"
        })


async def run_product_stream(
    user_input: str,
    session_id: Optional[str] = None,
    is_revision: bool = False
) -> AsyncGenerator[str, None]:
    """Run product design pipeline and stream progress."""
    logger.info(f"run_product_stream called")
    logger.info(f"  user_input: {user_input[:100]}...")
    logger.info(f"  session_id: {session_id}")
    logger.info(f"  is_revision: {is_revision}")
    
    try:
        # Check for existing session (revision)
        if session_id and session_id in _product_sessions and is_revision:
            logger.info("Creating revision from existing session")
            existing = _product_sessions[session_id]
            product_pipeline = existing.create_revision(user_input)
        else:
            # New session
            logger.info("Creating new product pipeline session")
            state = ProductState(user_input=user_input)
            state.session_key = session_id or f"product-{id(state)}"
            product_pipeline = ProductPipeline(state)
        
        # Store session
        _product_sessions[product_pipeline.state.session_key] = product_pipeline
        logger.info(f"Session stored: {product_pipeline.state.session_key}")
        
        # Emit session info
        yield sse_event({
            "type": "session_start",
            "session_id": product_pipeline.state.session_key,
            "version": product_pipeline.state.version,
        })
        
        async for event in product_pipeline.run():
            logger.debug(f"Product pipeline event: {event.get('type')}")
            yield sse_event(event)
            await asyncio.sleep(0.05)
            
    except Exception as e:
        logger.error(f"Product stream error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        yield sse_event({
            "type": "stage_failed",
            "stage": "unknown",
            "error": str(e)
        })
        yield sse_event({
            "type": "prd_complete",
            "version": 0,
            "prd": f"Error: {str(e)}"
        })


async def run_auto_stream(user_input: str) -> AsyncGenerator[str, None]:
    """Auto-detect intent and route to appropriate pipeline."""
    logger.info(f"run_auto_stream called with: {user_input[:100]}...")
    
    # Classify intent
    logger.info("Classifying intent...")
    intent, confidence = await classify_intent(user_input)
    logger.info(f"Intent: {intent.value}, confidence: {confidence}")
    
    yield sse_event({
        "type": "intent_detected",
        "intent": intent.value,
        "confidence": confidence,
    })
    
    if intent == Intent.DESIGN_PRODUCT:
        async for event in run_product_stream(user_input):
            yield event
    else:
        async for event in run_pipeline_stream(user_input):
            yield event


@router.post("/run")
async def run_pipeline_endpoint(request: RunPipelineRequest):
    """Run the debug pipeline with SSE streaming."""
    return StreamingResponse(
        run_pipeline_stream(request.user_input),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/design")
async def run_design_pipeline(request: DesignPipelineRequest):
    """Run the product design pipeline with SSE streaming."""
    return StreamingResponse(
        run_product_stream(
            request.user_input,
            request.session_id,
            request.is_revision
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/auto")
async def run_auto_pipeline(request: RunPipelineRequest):
    """Auto-detect intent and run appropriate pipeline."""
    return StreamingResponse(
        run_auto_stream(request.user_input),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
