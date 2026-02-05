import { useState, useEffect } from 'react'

// ============================================================================
// Types (match backend/src/lightning_loop/api/routes/jobs.py)
// ============================================================================

interface JobSpec {
  job_id: string
  title: string
  objective: string
  scope_included: string[]
  scope_excluded: string[]
  constraints: string[]
  success_criteria: string[]
  verification_commands: string[]
  dependencies: string[]
  estimated_iterations: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked'
  iterations_used: number
  started_at?: string
  completed_at?: string
  stop_reason?: string
}

interface InterpretResponse {
  stack_id: string
  jobs: JobSpec[]
  execution_order: string[]
  total_jobs: number
}

interface ProjectContext {
  project_path?: string
  language?: string
  framework?: string
  package_manager?: string
  description?: string
}

interface RalphEvent {
  type: 'started' | 'iteration' | 'action' | 'decision' | 'completed' | 'error' | 'log' | 'result'
  job_id: string
  data: Record<string, unknown>
}

// Execution log entry
interface LogEntry {
  timestamp: string
  type: string
  message: string
  level?: 'info' | 'error' | 'warn'
}

// ============================================================================
// API Calls
// ============================================================================

const API_BASE = 'http://localhost:8811'

async function interpretRequest(
  userRequest: string,
  projectContext?: ProjectContext,
  verbosity: 'low' | 'medium' | 'high' = 'medium'
): Promise<InterpretResponse> {
  const response = await fetch(`${API_BASE}/api/jobs/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_request: userRequest,
      project_context: projectContext,
      verbosity,
    }),
  })
  
  if (!response.ok) {
    throw new Error(`Failed to interpret request: ${response.status}`)
  }
  
  return response.json()
}

// ============================================================================
// Status Icons & Colors
// ============================================================================

function StatusIcon({ status }: { status: JobSpec['status'] }) {
  switch (status) {
    case 'pending':
      return <span className="text-white/30">○</span>
    case 'running':
      return <span className="text-blue-400 animate-pulse">●</span>
    case 'completed':
      return <span className="text-green-400">✓</span>
    case 'failed':
      return <span className="text-red-400">✗</span>
    case 'blocked':
      return <span className="text-yellow-400">⊘</span>
  }
}

function statusColor(status: JobSpec['status']): string {
  switch (status) {
    case 'pending': return 'border-white/10'
    case 'running': return 'border-blue-500/50 bg-blue-500/5'
    case 'completed': return 'border-green-500/30 bg-green-500/5'
    case 'failed': return 'border-red-500/30 bg-red-500/5'
    case 'blocked': return 'border-yellow-500/30 bg-yellow-500/5'
  }
}

// ============================================================================
// JobStackPanel Component
// ============================================================================

export function JobStackPanel() {
  const [userInput, setUserInput] = useState('')
  const [isInterpreting, setIsInterpreting] = useState(false)
  const [jobStack, setJobStack] = useState<InterpretResponse | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [verbosity, setVerbosity] = useState<'low' | 'medium' | 'high'>('medium')
  const [error, setError] = useState<string | null>(null)
  
  // Execution state
  const [isExecuting, setIsExecuting] = useState(false)
  const [executingJobId, setExecutingJobId] = useState<string | null>(null)
  const [currentIteration, setCurrentIteration] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)
  
  // Subscribe to Ralph events
  useEffect(() => {
    const handleRalphEvent = (event: RalphEvent) => {
      console.log('[JobStack] Ralph event:', event)
      
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        type: event.type,
        message: '',
        level: 'info',
      }
      
      switch (event.type) {
        case 'started':
          logEntry.message = `Started job: ${event.data.title}`
          break
        case 'iteration':
          logEntry.message = `Iteration ${event.data.iteration}/${event.data.max_iterations}`
          setCurrentIteration(event.data.iteration as number)
          break
        case 'action':
          logEntry.message = `Action: ${(event.data.outcome as string)} in ${(event.data.duration as number).toFixed(1)}s`
          break
        case 'decision':
          logEntry.message = `Decision: ${event.data.reason}`
          break
        case 'completed':
          logEntry.message = `Job ${event.data.success ? 'completed successfully' : 'completed with errors'}`
          handleJobCompleted(event.job_id, event.data.success as boolean)
          break
        case 'error':
          logEntry.message = `Error: ${event.data.message}`
          logEntry.level = 'error'
          break
        case 'log':
          logEntry.message = event.data.message as string
          logEntry.level = (event.data.level as 'info' | 'error' | 'warn') || 'info'
          break
        case 'result':
          logEntry.message = `Result: ${event.data.success ? 'Success' : 'Failed'} after ${event.data.iterations_used} iterations`
          break
      }
      
      setLogs(prev => [...prev.slice(-50), logEntry])  // Keep last 50 logs
    }
    
    window.electronAPI?.ralph?.onEvent(handleRalphEvent)
    
    return () => {
      window.electronAPI?.ralph?.removeEventListener()
    }
  }, [])
  
  // Handle job completion
  const handleJobCompleted = (jobId: string, success: boolean) => {
    setJobStack(prev => {
      if (!prev) return prev
      return {
        ...prev,
        jobs: prev.jobs.map(j => 
          j.job_id === jobId 
            ? { ...j, status: success ? 'completed' : 'failed' }
            : j
        ),
      }
    })
    
    setExecutingJobId(null)
    setCurrentIteration(0)
    
    // Check if there are more jobs to run
    const nextJob = jobStack?.jobs.find(j => j.status === 'pending')
    if (nextJob && isExecuting) {
      // Auto-run next job after a brief delay
      setTimeout(() => {
        executeJob(nextJob)
      }, 1000)
    } else {
      setIsExecuting(false)
    }
  }
  
  // Execute a single job via Ralph
  const executeJob = async (job: JobSpec) => {
    console.log('[JobStack] Executing job:', job.job_id)
    
    setExecutingJobId(job.job_id)
    setCurrentIteration(0)
    
    // Update job status to running
    setJobStack(prev => {
      if (!prev) return prev
      return {
        ...prev,
        jobs: prev.jobs.map(j => 
          j.job_id === job.job_id 
            ? { ...j, status: 'running', started_at: new Date().toISOString() }
            : j
        ),
      }
    })
    
    try {
      // Check if Ralph API is available
      if (!window.electronAPI?.ralph?.start) {
        throw new Error('Ralph API not available')
      }
      
      const result = await window.electronAPI.ralph.start({
        job_id: job.job_id,
        title: job.title,
        objective: job.objective,
        scope_included: job.scope_included,
        scope_excluded: job.scope_excluded,
        constraints: job.constraints,
        success_criteria: job.success_criteria,
        verification_commands: job.verification_commands,
        estimated_iterations: job.estimated_iterations,
      })
      
      console.log('[JobStack] Ralph start result:', result)
      
      if (!result?.success) {
        console.error('[JobStack] Failed to start job:', result?.error)
        setError(result?.error || 'Failed to start job')
        // Don't auto-continue on API failure - stop execution
        setIsExecuting(false)
        handleJobCompleted(job.job_id, false)
      }
      // If success, wait for events via onEvent callback
    } catch (e) {
      console.error('[JobStack] Execute error:', e)
      setError(e instanceof Error ? e.message : 'Unknown error')
      // Don't auto-continue on error - stop execution
      setIsExecuting(false)
      handleJobCompleted(job.job_id, false)
    }
  }

  const handleInterpret = async () => {
    if (!userInput.trim()) return
    
    setIsInterpreting(true)
    setError(null)
    
    try {
      console.log('[JobStack] Interpreting:', userInput)
      const result = await interpretRequest(userInput, undefined, verbosity)
      console.log('[JobStack] Got result:', result)
      setJobStack(result)
      setLogs([])  // Clear logs for new stack
    } catch (e) {
      console.error('[JobStack] Interpret error:', e)
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsInterpreting(false)
    }
  }

  const handleStartExecution = () => {
    if (!jobStack || jobStack.jobs.length === 0) return
    
    // Check if Ralph API is available
    if (!window.electronAPI?.ralph) {
      console.error('[JobStack] Ralph API not available')
      setError('Ralph execution is not available. Make sure you are running in Electron.')
      return
    }
    
    setIsExecuting(true)
    setLogs([])
    
    // Find first pending job
    const firstJob = jobStack.jobs.find(j => j.status === 'pending')
    if (firstJob) {
      executeJob(firstJob)
    }
  }
  
  const handleStopExecution = async () => {
    if (executingJobId) {
      await window.electronAPI?.ralph?.stop(executingJobId)
    }
    setIsExecuting(false)
  }

  const handleClear = () => {
    setJobStack(null)
    setExpandedJobId(null)
    setExecutingJobId(null)
    setIsExecuting(false)
    setCurrentIteration(0)
    setLogs([])
    setError(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/10">
        <h2 className="text-xs font-medium text-white/70">Job Stack</h2>
        <p className="text-[10px] text-white/30">Plain text → Structured jobs</p>
      </div>

      {/* Input Section */}
      {!jobStack && (
        <div className="p-3 border-b border-white/10">
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleInterpret()
              }
            }}
            placeholder="Describe what you want to build... e.g., 'Add OAuth, build landing page, add local DB'"
            className="w-full h-20 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 resize-none focus:outline-none focus:border-white/20 font-mono leading-relaxed"
            disabled={isInterpreting}
          />
          
          {/* Verbosity Toggle */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-white/30">Verbosity:</span>
              {(['low', 'medium', 'high'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVerbosity(v)}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                    verbosity === v
                      ? 'bg-white/20 text-white'
                      : 'text-white/30 hover:text-white/50'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            
            <button
              onClick={handleInterpret}
              disabled={isInterpreting || !userInput.trim()}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                isInterpreting || !userInput.trim()
                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                  : 'bg-white/90 text-black hover:bg-white'
              }`}
            >
              {isInterpreting ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 border border-black/30 border-t-transparent rounded-full animate-spin" />
                  Interpreting...
                </span>
              ) : (
                'Interpret'
              )}
            </button>
          </div>
          
          {error && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Job Stack Display */}
      {jobStack && (
        <>
          {/* Stack Header */}
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
            <div>
              <span className="text-xs text-white/70">{jobStack.total_jobs} jobs</span>
              <span className="text-[10px] text-white/30 ml-2">stack:{jobStack.stack_id.slice(0, 8)}</span>
              {executingJobId && (
                <span className="text-[10px] text-blue-400 ml-2">
                  iter {currentIteration}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isExecuting ? (
                <button
                  onClick={handleStartExecution}
                  className="px-2 py-1 bg-green-500/80 text-white text-[10px] rounded hover:bg-green-500 transition-colors"
                >
                  Start Execution
                </button>
              ) : (
                <button
                  onClick={handleStopExecution}
                  className="px-2 py-1 bg-red-500/80 text-white text-[10px] rounded hover:bg-red-500 transition-colors"
                >
                  Stop
                </button>
              )}
              <button
                onClick={() => setShowLogs(!showLogs)}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  showLogs 
                    ? 'bg-white/20 text-white' 
                    : 'text-white/30 hover:text-white/60'
                }`}
              >
                Logs ({logs.length})
              </button>
              <button
                onClick={handleClear}
                disabled={isExecuting}
                className="px-2 py-1 text-[10px] text-white/30 hover:text-white/60 transition-colors disabled:opacity-30"
              >
                Clear
              </button>
            </div>
          </div>
          
          {/* Execution Logs Panel */}
          {showLogs && (
            <div className="px-3 py-2 border-b border-white/10 max-h-32 overflow-y-auto bg-black/20">
              {logs.length === 0 ? (
                <p className="text-[10px] text-white/30">No logs yet</p>
              ) : (
                logs.slice(-20).map((log, i) => (
                  <div 
                    key={i} 
                    className={`text-[10px] font-mono ${
                      log.level === 'error' ? 'text-red-400' :
                      log.level === 'warn' ? 'text-yellow-400' :
                      'text-white/50'
                    }`}
                  >
                    <span className="text-white/20">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className="text-white/30 mx-1">[{log.type}]</span>
                    {log.message}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Jobs List */}
          <div className="flex-1 overflow-y-auto">
            {jobStack.jobs.map((job, index) => (
              <div
                key={job.job_id}
                className={`border-b border-white/5 ${statusColor(job.status)}`}
              >
                {/* Job Header */}
                <button
                  onClick={() => setExpandedJobId(
                    expandedJobId === job.job_id ? null : job.job_id
                  )}
                  className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
                >
                  <span className="text-white/30 text-[10px] w-4">{index + 1}</span>
                  <StatusIcon status={job.status} />
                  <span className="flex-1 text-xs text-white/80 truncate">{job.title}</span>
                  <span className="text-[10px] text-white/30">
                    ~{job.estimated_iterations} iter
                  </span>
                  <span className="text-white/30 text-[10px]">
                    {expandedJobId === job.job_id ? '▼' : '▶'}
                  </span>
                </button>

                {/* Expanded Details */}
                {expandedJobId === job.job_id && (
                  <div className="px-3 pb-3 space-y-2">
                    {/* Objective */}
                    <div>
                      <span className="text-[10px] text-white/40">Objective</span>
                      <p className="text-xs text-white/70 mt-0.5">{job.objective}</p>
                    </div>

                    {/* Scope */}
                    {job.scope_included.length > 0 && (
                      <div>
                        <span className="text-[10px] text-white/40">In Scope</span>
                        <ul className="mt-0.5">
                          {job.scope_included.map((s, i) => (
                            <li key={i} className="text-[10px] text-white/60">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Success Criteria */}
                    {job.success_criteria.length > 0 && (
                      <div>
                        <span className="text-[10px] text-white/40">Success Criteria</span>
                        <ul className="mt-0.5">
                          {job.success_criteria.map((s, i) => (
                            <li key={i} className="text-[10px] text-green-400/60">✓ {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Constraints */}
                    {job.constraints.length > 0 && (
                      <div>
                        <span className="text-[10px] text-white/40">Constraints</span>
                        <ul className="mt-0.5">
                          {job.constraints.map((c, i) => (
                            <li key={i} className="text-[10px] text-yellow-400/60">⚠ {c}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Dependencies */}
                    {job.dependencies.length > 0 && (
                      <div>
                        <span className="text-[10px] text-white/40">Dependencies</span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {job.dependencies.map((dep, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] text-white/50"
                            >
                              {dep}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Verification Commands */}
                    {job.verification_commands.length > 0 && (
                      <div>
                        <span className="text-[10px] text-white/40">Verification</span>
                        <div className="mt-0.5 space-y-1">
                          {job.verification_commands.map((cmd, i) => (
                            <code
                              key={i}
                              className="block text-[10px] text-blue-400/70 bg-black/20 px-2 py-1 rounded font-mono"
                            >
                              $ {cmd}
                            </code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty State */}
      {!jobStack && !error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl mb-2">📋</div>
            <p className="text-xs text-white/30">Enter a request above</p>
            <p className="text-[10px] text-white/20">⌘ + Enter to interpret</p>
          </div>
        </div>
      )}
    </div>
  )
}
