#!/bin/bash
# Invene - Start all services
# Usage: ./run.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting Invene..."
echo ""

# Kill any existing processes on our ports
echo "Cleaning up old processes..."
lsof -ti:8811 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:5174 | xargs kill -9 2>/dev/null || true

sleep 1

# Start Backend (FastAPI on port 8811)
echo "Starting backend on :8811..."
cd "$PROJECT_ROOT/backend"
export PYTHONPATH="$PROJECT_ROOT/backend/src"
python3 -m uvicorn lightning_loop.main:app --host 0.0.0.0 --port 8811 &
BACKEND_PID=$!

# Wait for backend to be ready
sleep 2

# Start Web Orchestrator (Next.js on port 3000)
echo "Starting web on :3000..."
cd "$PROJECT_ROOT/web-orchestrator"
npm run dev &
WEB_PID=$!

# Wait for web to be ready
sleep 3

# Build and start Electron
echo "Building electron..."
cd "$PROJECT_ROOT/electron"
npm run build 2>/dev/null || true

echo "Starting electron..."
npm run start &
ELECTRON_PID=$!

echo ""
echo "✅ All services started!"
echo ""
echo "   Backend:  http://localhost:8811"
echo "   Website:  http://localhost:3000"
echo "   Electron: Running"
echo ""
echo "Press Ctrl+C to stop all services"

# Trap to kill all processes on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $WEB_PID 2>/dev/null || true
    kill $ELECTRON_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for any process to exit
wait
