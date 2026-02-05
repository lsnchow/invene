import { create } from 'zustand'

// Debug pipeline stages
export type DebugStage = 
  | 'observation' 
  | 'intent' 
  | 'decomposition' 
  | 'strategy' 
  | 'compilation' 
  | 'injection' 
  | 'outcome' 
  | 'decision'

// Product design pipeline stages
export type ProductStage =
  | 'idea_grounding'
  | 'problem_definition'
  | 'user_framing'
  | 'solution_shaping'
  | 'feature_decomposition'
  | 'system_design'
  | 'risk_analysis'
  | 'mvp_definition'
  | 'milestone_planning'
  | 'prd_assembly'

export type PipelineStage = DebugStage | ProductStage
export type PipelineMode = 'auto' | 'debug' | 'design'

export type NoteStatus = 'pending' | 'running' | 'completed' | 'failed'
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface ProgressNote {
  id: string
  iterationId: number
  stage: PipelineStage
  status: NoteStatus
  humanSummary: string
  technicalDetail?: string
  depthLevel: 0 | 1 | 2
  timestampStart: number
  timestampEnd?: number
}

export interface QueuedTask {
  id: string
  prompt: string
  status: TaskStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}

// Ralph Loop types
export interface RalphIteration {
  iteration: number
  action: string
  outcome: 'success' | 'failure' | 'timeout' | 'partial'
  result?: string
  error?: string
  decision?: string
  decisionReasoning?: string
  duration: number
}

export interface RalphLoopState {
  loopId: string | null
  objective: string
  actuator: 'copilot' | 'terminal'
  maxIterations: number
  currentIteration: number
  iterations: RalphIteration[]
  isRunning: boolean
  stopReason: string | null
  finalSummary: string | null
}

// Orchestrator integration types
export interface OrchestratorTaskNode {
  node_id: string
  title: string
  node_type: string
  objective: string
  constraints?: string[]
  success_checks?: string[]
  doc_refs?: string[]
  dependencies: string[]
  ralph_profile?: string
}

export interface OrchestratorJob {
  job_id: string
  graph_id: string
  status: string
  taskgraph: {
    graph_id?: string
    created_at?: string
    user_request?: string
    slider_preset?: {
      verbosity?: string
      autonomy?: string
      risk_tolerance?: string
    }
    inputs?: Record<string, unknown>
    nodes?: OrchestratorTaskNode[]
    edges?: Array<{
      from_node_id: string
      to_node_id: string
      edge_type: string
    }>
  }
  current_node_id?: string
  current_node_index?: number
}

export interface LoopStore {
  // Input
  userInput: string
  setUserInput: (input: string) => void
  
  // Pipeline mode
  pipelineMode: PipelineMode
  detectedIntent: string | null
  sessionId: string | null
  prdVersion: number
  
  // Execution state
  isRunning: boolean
  currentStage: PipelineStage | null
  notes: ProgressNote[]
  iterationCount: number
  finalResult: string | null
  prdOutput: string | null
  error: string | null
  
  // Ralph Loop state
  ralph: RalphLoopState
  
  // Orchestrator integration
  orchestratorJob: OrchestratorJob | null
  isPollingOrchestrator: boolean
  
  // Task Queue
  queue: QueuedTask[]
  isProcessingQueue: boolean
  addToQueue: (prompt: string) => void
  removeFromQueue: (id: string) => void
  clearQueue: () => void
  processQueue: () => Promise<void>
  
  // Actions
  runCommand: () => Promise<void>
  runRevision: (revisionRequest: string) => Promise<void>
  pasteToEditor: () => Promise<void>
  stopLoop: () => void
  updateNote: (id: string, updates: Partial<ProgressNote>) => void
  clearNotes: () => void
  
  // Ralph Actions
  startRalphLoop: (objective: string, actuator?: 'copilot' | 'terminal') => Promise<void>
  stopRalphLoop: () => Promise<void>
  clearRalph: () => void
  
  // Orchestrator Actions
  checkOrchestratorJobs: () => Promise<void>
  claimOrchestratorJob: (jobId: string) => Promise<void>
  startOrchestratorPolling: () => void
  stopOrchestratorPolling: () => void
}

const API_BASE = 'http://localhost:8811'

export const DEBUG_STAGE_SUMMARIES: Record<DebugStage, string> = {
  observation: "Reading your input and recent output",
  intent: "Figuring out what you want to accomplish",
  decomposition: "Breaking the problem into steps",
  strategy: "Choosing the safest approach",
  compilation: "Preparing instructions for the assistant",
  injection: "Applying changes directly in your editor",
  outcome: "Checking what happened after the changes",
  decision: "Deciding what to do next"
}

export const PRODUCT_STAGE_SUMMARIES: Record<ProductStage, string> = {
  idea_grounding: "Grounding your product idea",
  problem_definition: "Defining the core problem",
  user_framing: "Identifying target users",
  solution_shaping: "Shaping the solution approach",
  feature_decomposition: "Breaking down features",
  system_design: "Designing system architecture",
  risk_analysis: "Analyzing risks and constraints",
  mvp_definition: "Scoping the MVP",
  milestone_planning: "Planning milestones",
  prd_assembly: "Assembling final PRD"
}

export const STAGE_SUMMARIES: Record<PipelineStage, string> = {
  ...DEBUG_STAGE_SUMMARIES,
  ...PRODUCT_STAGE_SUMMARIES,
}

export const useLoopStore = create<LoopStore>((set, get) => ({
  // Initial state
  userInput: '',
  pipelineMode: 'auto',
  detectedIntent: null,
  sessionId: null,
  prdVersion: 0,
  isRunning: false,
  currentStage: null,
  notes: [],
  iterationCount: 0,
  finalResult: null,
  prdOutput: null,
  error: null,
  
  // Orchestrator state
  orchestratorJob: null,
  isPollingOrchestrator: false,
  
  // Ralph state
  ralph: {
    loopId: null,
    objective: '',
    actuator: 'copilot',
    maxIterations: 10,
    currentIteration: 0,
    iterations: [],
    isRunning: false,
    stopReason: null,
    finalSummary: null,
  },
  
  // Queue state
  queue: [],
  isProcessingQueue: false,

  setUserInput: (input) => set({ userInput: input }),

  updateNote: (id, updates) => {
    set((state) => ({
      notes: state.notes.map(n => n.id === id ? { ...n, ...updates } : n)
    }))
  },

  clearNotes: () => set({ 
    notes: [], 
    iterationCount: 0, 
    finalResult: null, 
    prdOutput: null,
    error: null,
    detectedIntent: null,
  }),

  stopLoop: () => {
    set({ isRunning: false, currentStage: null })
  },
  
  // Queue management
  addToQueue: (prompt) => {
    const task: QueuedTask = {
      id: `task-${Date.now()}`,
      prompt,
      status: 'queued',
      createdAt: Date.now(),
    }
    set((state) => ({ queue: [...state.queue, task] }))
    
    // Auto-start processing if not already running
    const { isProcessingQueue, processQueue } = get()
    if (!isProcessingQueue) {
      processQueue()
    }
  },
  
  removeFromQueue: (id) => {
    set((state) => ({ queue: state.queue.filter(t => t.id !== id) }))
  },
  
  clearQueue: () => {
    set({ queue: [] })
  },
  
  processQueue: async () => {
    const { queue, isProcessingQueue, isRunning } = get()
    
    if (isProcessingQueue || isRunning) return
    
    const nextTask = queue.find(t => t.status === 'queued')
    if (!nextTask) return
    
    set({ isProcessingQueue: true })
    
    // Update task status
    set((state) => ({
      queue: state.queue.map(t => 
        t.id === nextTask.id 
          ? { ...t, status: 'running' as TaskStatus, startedAt: Date.now() }
          : t
      )
    }))
    
    // Set the input and run
    set({ userInput: nextTask.prompt })
    
    try {
      await get().runCommand()
      
      // Mark task complete
      set((state) => ({
        queue: state.queue.map(t =>
          t.id === nextTask.id
            ? { ...t, status: 'completed' as TaskStatus, completedAt: Date.now(), result: state.finalResult || undefined }
            : t
        )
      }))
    } catch (error) {
      set((state) => ({
        queue: state.queue.map(t =>
          t.id === nextTask.id
            ? { ...t, status: 'failed' as TaskStatus, completedAt: Date.now(), error: String(error) }
            : t
        )
      }))
    }
    
    set({ isProcessingQueue: false })
    
    // Process next task in queue
    const { queue: updatedQueue } = get()
    if (updatedQueue.some(t => t.status === 'queued')) {
      get().processQueue()
    }
  },

  runCommand: async () => {
    const { userInput, updateNote } = get()
    
    if (!userInput.trim()) return
    
    set({ 
      isRunning: true, 
      notes: [], 
      iterationCount: 0, 
      finalResult: null, 
      prdOutput: null,
      error: null,
      detectedIntent: null,
    })

    try {
      // Use auto endpoint for intent detection
      const response = await fetch(`${API_BASE}/api/pipeline/auto`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({ user_input: userInput }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      
      if (!reader) {
        throw new Error('No response body')
      }

      let currentNoteId: string | null = null
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          
          try {
            const data = JSON.parse(line.slice(6))
            
            // Intent detection
            if (data.type === 'intent_detected') {
              set({ detectedIntent: data.intent })
            }
            // Session info (for product pipeline)
            else if (data.type === 'session_start') {
              set({ 
                sessionId: data.session_id,
                prdVersion: data.version,
              })
            }
            else if (data.type === 'stage_start') {
              const noteId = `note-${Date.now()}-${data.stage}`
              set((state) => ({
                currentStage: data.stage,
                iterationCount: data.iteration || state.iterationCount,
                notes: [...state.notes, {
                  id: noteId,
                  iterationId: data.iteration || 1,
                  stage: data.stage,
                  status: 'running' as NoteStatus,
                  humanSummary: data.summary || STAGE_SUMMARIES[data.stage as PipelineStage] || data.stage,
                  depthLevel: 0,
                  timestampStart: Date.now(),
                }]
              }))
              currentNoteId = noteId
            } 
            else if (data.type === 'stage_complete') {
              if (currentNoteId) {
                updateNote(currentNoteId, {
                  status: 'completed',
                  timestampEnd: Date.now(),
                  technicalDetail: data.detail,
                })
              }
            }
            else if (data.type === 'stage_failed') {
              if (currentNoteId) {
                updateNote(currentNoteId, {
                  status: 'failed',
                  timestampEnd: Date.now(),
                  technicalDetail: data.error,
                })
              }
            }
            else if (data.type === 'iteration_complete') {
              set({ iterationCount: data.iteration })
            }
            // Debug pipeline complete
            else if (data.type === 'loop_complete') {
              set({ 
                isRunning: false, 
                currentStage: null,
                finalResult: data.result || 'Completed successfully'
              })
            }
            // Product pipeline complete - auto paste to editor
            else if (data.type === 'prd_complete') {
              set({ 
                isRunning: false, 
                currentStage: null,
                prdVersion: data.version,
                prdOutput: data.prd,
                finalResult: `PRD v${data.version} ready`
              })
              
              // Auto-open PRD in VS Code
              if (data.prd) {
                try {
                  const result = await window.electronAPI?.automation.openPrdInEditor(data.prd, 'vscode')
                  if (result?.success) {
                    console.log('PRD opened at:', result.filePath)
                  } else {
                    console.error('Failed to open PRD:', result?.error)
                  }
                } catch (e) {
                  console.error('Auto-open failed:', e)
                }
              }
            }
            else if (data.type === 'progress_update') {
              if (currentNoteId) {
                updateNote(currentNoteId, {
                  humanSummary: data.message || STAGE_SUMMARIES[data.stage as PipelineStage],
                })
              }
            }
          } catch (e) {
            console.error('Failed to parse SSE data:', e, line)
          }
        }
      }

      // If we exit the loop without a complete event, mark as done
      if (get().isRunning) {
        set({ isRunning: false, currentStage: null })
      }

    } catch (error) {
      console.error('Pipeline error:', error)
      set({ 
        isRunning: false, 
        currentStage: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  },

  runRevision: async (revisionRequest: string) => {
    const { sessionId, updateNote } = get()
    
    if (!revisionRequest.trim() || !sessionId) return
    
    set({ 
      isRunning: true, 
      notes: [], 
      error: null,
      userInput: revisionRequest,
    })

    try {
      const response = await fetch(`${API_BASE}/api/pipeline/design`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({ 
          user_input: revisionRequest,
          session_id: sessionId,
          is_revision: true,
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      
      if (!reader) {
        throw new Error('No response body')
      }

      let currentNoteId: string | null = null
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          
          try {
            const data = JSON.parse(line.slice(6))
            
            if (data.type === 'session_start') {
              set({ prdVersion: data.version })
            }
            else if (data.type === 'stage_start') {
              const noteId = `note-${Date.now()}-${data.stage}`
              set((state) => ({
                currentStage: data.stage,
                notes: [...state.notes, {
                  id: noteId,
                  iterationId: 1,
                  stage: data.stage,
                  status: 'running' as NoteStatus,
                  humanSummary: data.summary || STAGE_SUMMARIES[data.stage as PipelineStage] || data.stage,
                  depthLevel: 0,
                  timestampStart: Date.now(),
                }]
              }))
              currentNoteId = noteId
            }
            else if (data.type === 'stage_complete') {
              if (currentNoteId) {
                updateNote(currentNoteId, {
                  status: 'completed',
                  timestampEnd: Date.now(),
                  technicalDetail: data.detail,
                })
              }
            }
            else if (data.type === 'stage_failed') {
              if (currentNoteId) {
                updateNote(currentNoteId, {
                  status: 'failed',
                  timestampEnd: Date.now(),
                  technicalDetail: data.error,
                })
              }
            }
            else if (data.type === 'prd_complete') {
              set({ 
                isRunning: false, 
                currentStage: null,
                prdVersion: data.version,
                prdOutput: data.prd,
                finalResult: `PRD v${data.version} ready`
              })
            }
          } catch (e) {
            console.error('Failed to parse SSE data:', e, line)
          }
        }
      }

      if (get().isRunning) {
        set({ isRunning: false, currentStage: null })
      }

    } catch (error) {
      console.error('Revision error:', error)
      set({ 
        isRunning: false, 
        currentStage: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  },

  pasteToEditor: async () => {
    const { prdOutput } = get()
    if (!prdOutput) return
    
    try {
      // Write PRD to file and open in VS Code
      const result = await window.electronAPI?.automation.openPrdInEditor(prdOutput, 'vscode')
      if (result?.success) {
        console.log('PRD opened at:', result.filePath)
      } else {
        console.error('Failed to open PRD:', result?.error)
      }
    } catch (e) {
      console.error('Failed to open PRD in editor:', e)
    }
  },

  // Ralph Loop Actions
  startRalphLoop: async (objective: string, actuator: 'copilot' | 'terminal' = 'copilot') => {
    const { ralph } = get()
    if (ralph.isRunning) return

    set({
      ralph: {
        ...ralph,
        objective,
        actuator,
        isRunning: true,
        loopId: null,
        currentIteration: 0,
        iterations: [],
        stopReason: null,
        finalSummary: null,
      },
      isRunning: true,
      error: null,
    })

    try {
      const response = await fetch(`${API_BASE}/api/ralph/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          actuator,
          max_iterations: 10,
        }),
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          
          try {
            const data = JSON.parse(line.slice(6))
            
            if (data.type === 'loop_start') {
              set(state => ({
                ralph: { ...state.ralph, loopId: data.loop_id }
              }))
            }
            else if (data.type === 'iteration_start') {
              set(state => ({
                ralph: { 
                  ...state.ralph, 
                  currentIteration: data.iteration,
                }
              }))
            }
            else if (data.type === 'iteration_end') {
              const iteration: RalphIteration = {
                iteration: data.iteration,
                action: data.action || '',
                outcome: data.outcome || 'success',
                result: data.result,
                error: data.error,
                decision: data.decision,
                decisionReasoning: data.decision_reasoning,
                duration: data.duration || 0,
              }
              set(state => ({
                ralph: {
                  ...state.ralph,
                  iterations: [...state.ralph.iterations, iteration],
                }
              }))
            }
            else if (data.type === 'loop_complete') {
              set(state => ({
                ralph: {
                  ...state.ralph,
                  isRunning: false,
                  stopReason: data.stop_reason,
                  finalSummary: data.final_summary,
                },
                isRunning: false,
              }))
            }
            else if (data.type === 'error') {
              set(state => ({
                ralph: { ...state.ralph, isRunning: false },
                isRunning: false,
                error: data.message,
              }))
            }
          } catch (e) {
            console.error('Failed to parse Ralph SSE:', e, line)
          }
        }
      }

      // Ensure we're stopped
      if (get().ralph.isRunning) {
        set(state => ({
          ralph: { ...state.ralph, isRunning: false },
          isRunning: false,
        }))
      }

    } catch (error) {
      console.error('Ralph loop error:', error)
      set(state => ({
        ralph: { ...state.ralph, isRunning: false },
        isRunning: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }))
    }
  },

  stopRalphLoop: async () => {
    const { ralph } = get()
    if (!ralph.isRunning || !ralph.loopId) return

    try {
      await fetch(`${API_BASE}/api/ralph/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loop_id: ralph.loopId,
          reason: 'User requested stop',
        }),
      })
    } catch (e) {
      console.error('Failed to stop Ralph loop:', e)
    }

    set(state => ({
      ralph: { ...state.ralph, isRunning: false, stopReason: 'User stopped' },
      isRunning: false,
    }))
  },

  clearRalph: () => {
    set(state => ({
      ralph: {
        loopId: null,
        objective: '',
        actuator: 'copilot',
        maxIterations: 10,
        currentIteration: 0,
        iterations: [],
        isRunning: false,
        stopReason: null,
        finalSummary: null,
      },
    }))
  },
  
  // Orchestrator integration methods
  checkOrchestratorJobs: async () => {
    console.log('[DEBUG] checkOrchestratorJobs: Starting check...')
    try {
      console.log('[DEBUG] checkOrchestratorJobs: Fetching from', `${API_BASE}/api/relay/jobs/next`)
      const response = await fetch(`${API_BASE}/api/relay/jobs/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimed_by: 'invene-desktop' }),
      })
      console.log('[DEBUG] checkOrchestratorJobs: Response status', response.status)
      if (!response.ok) {
        if (response.status === 404) {
          console.log('[DEBUG] checkOrchestratorJobs: No pending jobs (404)')
          set({ orchestratorJob: null })
          return
        }
        throw new Error(`Failed to check jobs: ${response.status}`)
      }
      
      const data = await response.json()
      console.log('[DEBUG] checkOrchestratorJobs: Got data', data)
      if (data) {
        console.log('[DEBUG] checkOrchestratorJobs: Setting orchestratorJob', data.job_id)
        set({ orchestratorJob: data })
      } else {
        console.log('[DEBUG] checkOrchestratorJobs: No job data, setting null')
        set({ orchestratorJob: null })
      }
    } catch (error) {
      console.error('[DEBUG] checkOrchestratorJobs: Error', error)
    }
  },
  
  claimOrchestratorJob: async (jobId: string) => {
    console.log('[DEBUG] claimOrchestratorJob: Claiming job', jobId)
    try {
      const response = await fetch(`${API_BASE}/api/relay/jobs/${jobId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimed_by: 'invene-desktop' }),
      })
      
      console.log('[DEBUG] claimOrchestratorJob: Response status', response.status)
      if (!response.ok) {
        throw new Error(`Failed to claim job: ${response.status}`)
      }
      
      const { orchestratorJob } = get()
      console.log('[DEBUG] claimOrchestratorJob: Current job', orchestratorJob)
      if (orchestratorJob) {
        // Execute the task graph nodes
        const nodes = orchestratorJob.taskgraph?.nodes || []
        const objective = `Execute the following task graph for: ${orchestratorJob.taskgraph?.user_request || 'unknown request'}\n\nNodes to execute:\n${
          nodes.map(n => `- ${n.title}: ${n.objective}`).join('\n')
        }`
        
        console.log('[DEBUG] claimOrchestratorJob: Starting Ralph loop with objective')
        set({ userInput: objective })
        get().startRalphLoop(objective, 'copilot')
      }
    } catch (error) {
      console.error('[DEBUG] claimOrchestratorJob: Error', error)
    }
  },
  
  startOrchestratorPolling: () => {
    console.log('[DEBUG] startOrchestratorPolling: Starting polling...')
    set({ isPollingOrchestrator: true })
    
    // Poll every 5 seconds
    const poll = async () => {
      const { isPollingOrchestrator } = get()
      console.log('[DEBUG] poll: isPollingOrchestrator =', isPollingOrchestrator)
      if (!isPollingOrchestrator) return
      
      await get().checkOrchestratorJobs()
      
      setTimeout(poll, 5000)
    }
    
    poll()
  },
  
  stopOrchestratorPolling: () => {
    console.log('[DEBUG] stopOrchestratorPolling: Stopping polling')
    set({ isPollingOrchestrator: false })
  },
}))
