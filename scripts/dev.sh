#!/bin/bash
# Start development servers for Lightning Loop

set -e

echo "⚡ Starting Lightning Loop..."
echo ""

# Start FastAPI backend
echo "🐍 Starting FastAPI backend on :8811..."
cd backend
python -m uvicorn lightning_loop.main:app --reload --port 8811 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Start Electron + Vite
echo "⚛️  Starting Electron with Vite..."
cd electron
npm run dev &
ELECTRON_PID=$!
cd ..

# Trap to clean up on exit
trap "kill $BACKEND_PID $ELECTRON_PID 2>/dev/null" EXIT

echo ""
echo "✅ Lightning Loop is running!"
echo "   Backend:  http://localhost:8811"
echo "   Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop"

# Wait for processes
wait
