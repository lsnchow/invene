import { create } from 'zustand'

export type LoopMode = 'fix-error' | 'make-tests-pass' | 'refactor' | 'explain'

export interface GraphNode {
  id: string
  type: 'input' | 'observation' | 'hypothesis' | 'fix' | 'validation' | 'memory' | 'next'
  label: string
  content: string
  position: { x: number; y: number }
}

export interface GraphEdge {
  id: string
  source: string
  target: string
}

export interface Iteration {
  id: string
  timestamp: number
  mode: LoopMode
  input: {
    errorOutput: string
    context: string
    language: string
    projectPath: string
  }
  analysis: {
    rootCause: string
    observations: string[]
  } | null
  proposal: {
    plan: string
    patchStrategy: string
    optimizedPrompt: string
  } | null
  validation: {
    status: 'pending' | 'success' | 'failure'
    feedback: string
  } | null
  metrics: {
    naiveTokens: number
    optimizedTokens: number
    savedTokens: number
  } | null
  graphNodes: GraphNode[]
  graphEdges: GraphEdge[]
}

export interface LoopStore {
  // State
  currentMode: LoopMode
  currentInput: {
    errorOutput: string
    context: string
    language: string
    projectPath: string
  }
  iterations: Iteration[]
  currentIterationId: string | null
  isLoading: boolean
  error: string | null

  // Actions
  setMode: (mode: LoopMode) => void
  setInput: (input: Partial<LoopStore['currentInput']>) => void
  clearInput: () => void
  runLoop: () => Promise<void>
  markValidation: (iterationId: string, status: 'success' | 'failure', feedback: string) => void
  clearIterations: () => void
}

const API_BASE = 'http://localhost:8811'

export const useLoopStore = create<LoopStore>((set, get) => ({
  // Initial state
  currentMode: 'fix-error',
  currentInput: {
    errorOutput: '',
    context: '',
    language: 'python',
    projectPath: '',
  },
  iterations: [],
  currentIterationId: null,
  isLoading: false,
  error: null,

  // Actions
  setMode: (mode) => set({ currentMode: mode }),

  setInput: (input) => set((state) => ({
    currentInput: { ...state.currentInput, ...input }
  })),

  clearInput: () => set({
    currentInput: { errorOutput: '', context: '', language: 'python', projectPath: '' }
  }),

  runLoop: async () => {
    const { currentMode, currentInput, iterations } = get()
    
    set({ isLoading: true, error: null })

    try {
      const response = await fetch(`${API_BASE}/api/loop/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: currentMode,
          input: currentInput,
          previous_iterations: iterations.map(i => i.id),
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const result = await response.json()
      
      const newIteration: Iteration = {
        id: result.iteration_id,
        timestamp: Date.now(),
        mode: currentMode,
        input: currentInput,
        analysis: result.analysis,
        proposal: result.proposal,
        validation: { status: 'pending', feedback: '' },
        metrics: result.metrics,
        graphNodes: result.graph_nodes || [],
        graphEdges: result.graph_edges || [],
      }

      set((state) => ({
        iterations: [...state.iterations, newIteration],
        currentIterationId: newIteration.id,
        isLoading: false,
      }))

    } catch (error) {
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      })
    }
  },

  markValidation: (iterationId, status, feedback) => {
    set((state) => ({
      iterations: state.iterations.map(i => 
        i.id === iterationId 
          ? { ...i, validation: { status, feedback } }
          : i
      )
    }))

    // Persist to backend
    fetch(`${API_BASE}/api/loop/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iteration_id: iterationId, status, feedback }),
    }).catch(console.error)
  },

  clearIterations: () => set({ iterations: [], currentIterationId: null }),
}))
