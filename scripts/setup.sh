#!/bin/bash
# Development startup script for Lightning Loop

set -e

echo "⚡ Starting Lightning Loop Development Environment"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3.11+"
    exit 1
fi

# Check Node
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

# Install root dependencies
echo "📦 Installing root dependencies..."
npm install

# Install Electron dependencies
echo "📦 Installing Electron dependencies..."
cd electron && npm install && cd ..

# Install Python dependencies
echo "🐍 Installing Python dependencies..."
cd backend && pip install -e . && cd ..

# Check for .env
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  No .env file found. Copying from .env.example..."
    cp .env.example .env
    echo "   Please edit .env with your Backboard API key"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start development:"
echo "  npm run dev"
echo ""
echo "Or run components separately:"
echo "  npm run dev:backend   # Start FastAPI on :8811"
echo "  npm run dev:electron  # Start Electron + Vite"
