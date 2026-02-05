"""FastAPI application entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from lightning_loop.api.routes import loop, health, pipeline, ralph, relay, graph, documents
from lightning_loop.core.config import settings

app = FastAPI(
    title="Lightning Loop API",
    description="Local stateful debug loop with memory",
    version="0.1.0",
)

# CORS for Electron renderer and web orchestrator
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(loop.router, prefix="/api/loop", tags=["loop"])
app.include_router(pipeline.router, prefix="/api/pipeline", tags=["pipeline"])
app.include_router(ralph.router, prefix="/api/ralph", tags=["ralph"])
app.include_router(relay.router, prefix="/api", tags=["relay"])
app.include_router(graph.router, prefix="/api", tags=["graph"])
app.include_router(documents.router, prefix="/api", tags=["documents"])


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    print(f"🚀 Lightning Loop API starting on port {settings.port}")
    print(f"📦 Backboard: {'configured' if settings.backboard_api_key else 'not configured'}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    print("👋 Lightning Loop API shutting down")
