# Invene ⚡

Video Demo Link: https://www.youtube.com/watch?v=M4ktjFTTZIw

Local stateful debug loop with memory for coding agents. Shorten debug cycles, persist context across iterations, and generate optimized prompts for VS Code/Cursor.

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- Backboard API key

### Setup

1. **Install dependencies**
   ```bash
   npm install
   cd electron && npm install
   cd ../backend && pip install -e .
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Backboard API key
   ```

3. **Run development mode**
   ```bash
   npm run dev
   ```

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Electron App (UI)                  │
│  ┌─────────────┐         ┌─────────────────┐   │
│  │ Main Process│◄──IPC──►│ React Renderer  │   │
│  └──────┬──────┘         └─────────────────┘   │
│         │                                       │
│         │ HTTP :8811                            │
│         ▼                                       │
│  ┌─────────────────────────────────────────┐   │
│  │         FastAPI Local Service            │   │
│  │  ┌───────────────────────────────────┐  │   │
│  │  │     Backboard Memory Layer        │  │   │
│  │  │  (failures, successes, context)   │  │   │
│  │  └───────────────────────────────────┘  │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Features

- **Floating overlay** - Always-on-top lightning button with global hotkey
- **Command drawer** - Modes: Fix error, Make tests pass, Refactor, Explain
- **Loop console** - Iteration timeline with token metrics
- **Thinking graph** - Visual node graph of loop state
- **Memory persistence** - Avoid repeated failed fixes via Backboard
- **One-click paste** - Export optimized prompts to VS Code/Cursor

## Project Structure

```
lightning-loop/
├── electron/           # Electron main + preload
├── renderer/           # React UI (embedded in electron)
├── backend/            # FastAPI service
│   └── lightning_loop/
│       ├── main.py     # API endpoints
│       ├── backboard/  # Memory layer
│       └── loop/       # Loop engine
└── shared/             # Shared types
```
