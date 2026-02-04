"""FastAPI application entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from lightning_loop.api.routes import loop, health
from lightning_loop.core.config import settings

app = FastAPI(
    title="Lightning Loop API",
    description="Local stateful debug loop with memory",
    version="0.1.0",
)

# CORS for Electron renderer
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


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    print(f"🚀 Lightning Loop API starting on port {settings.port}")
    print(f"📦 Backboard: {'configured' if settings.backboard_api_key else 'not configured'}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    print("👋 Lightning Loop API shutting down")
