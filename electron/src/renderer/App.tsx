import { useState, useEffect, useCallback } from 'react'
import { TitleBar } from './components/TitleBar'
import { JobFlowView, JobStackData, JobSpec } from './components/JobFlowView'

const API_BASE = 'http://localhost:8811'

export default function App() {
  const [mode, setMode] = useState<'input' | 'execute'>('input')
  const [prompt, setPrompt] = useState('')
  const [jobStack, setJobStack] = useState<JobStackData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Listen for confirmed job stack from website via API polling
  useEffect(() => {
    const checkForConfirmedJobs = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/jobs/confirmed`)
        const data = await response.json()
        
        if (data.has_jobs && data.job_stack) {
          console.log('[App] Received confirmed jobs:', data.job_stack)
          setJobStack(data.job_stack)
          setMode('execute')
        }
      } catch (e) {
        // Silently ignore - backend might not be running
      }
    }
    
    // Poll every 2 seconds
    const interval = setInterval(checkForConfirmedJobs, 2000)
    
    // Also check on focus (when user comes back from browser)
    window.addEventListener('focus', checkForConfirmedJobs)
    
    return () => {
      window.removeEventListener('focus', checkForConfirmedJobs)
      clearInterval(interval)
    }
  }, [])

  // Generate jobs and open in browser for editing
  const generateAndOpenBrowser = () => {
    if (!prompt.trim()) return
    
    setIsLoading(true)
    setError(null)
    
    // Open browser with prompt - website will interpret and show flow
    const encoded = encodeURIComponent(prompt)
    const url = `http://localhost:3000?prompt=${encoded}`
    
    // Try Electron API first, fall back to window.open
    if (window.electronAPI && 'openExternal' in window.electronAPI) {
      (window.electronAPI as any).openExternal(url)
    } else {
      window.open(url, '_blank')
    }
    
    setIsLoading(false)
  }

  // Execute jobs ONE BY ONE
  const executeJobs = useCallback(async () => {
    if (!jobStack || isExecuting) return
    
    setIsExecuting(true)
    setError(null)
    
    // Get job IDs in order (we can't rely on state updates mid-loop)
    const jobIds = jobStack.jobs
      .filter(j => j.status === 'pending')
      .map(j => j.job_id)
    
    for (const jobId of jobIds) {
      // Get the current job data from the latest state
      const job = jobStack.jobs.find(j => j.job_id === jobId)
      if (!job) continue
      
      setCurrentJobId(jobId)
      
      // Update job to running
      setJobStack(prev => {
        if (!prev) return prev
        return {
          ...prev,
          jobs: prev.jobs.map(j => 
            j.job_id === jobId ? { ...j, status: 'running' as const, iterations_used: 0 } : j
          ),
        }
      })
      
      // Small delay to let UI update
      await new Promise(r => setTimeout(r, 100))
      
      try {
        // Execute this single job via Ralph
        const result = await executeSingleJob(job, (update) => {
          // Update progress in real-time
          setJobStack(prev => {
            if (!prev) return prev
            return {
              ...prev,
              jobs: prev.jobs.map(j => 
                j.job_id === jobId ? { ...j, ...update } : j
              ),
            }
          })
        })
        
        // Mark as completed or failed
        setJobStack(prev => {
          if (!prev) return prev
          return {
            ...prev,
            jobs: prev.jobs.map(j => 
              j.job_id === jobId 
                ? { ...j, status: result.success ? 'completed' : 'failed', currentAction: undefined } 
                : j
            ),
          }
        })
        
        // Wait a bit before next job so UI can update
        await new Promise(r => setTimeout(r, 200))
        
        if (!result.success) {
          setError(`Job "${job.title}" failed: ${result.error}`)
          break
        }
      } catch (e) {
        setJobStack(prev => {
          if (!prev) return prev
          return {
            ...prev,
            jobs: prev.jobs.map(j => 
              j.job_id === jobId ? { ...j, status: 'failed' } : j
            ),
          }
        })
        setError(e instanceof Error ? e.message : 'Execution failed')
        break
      }
    }
    
    setIsExecuting(false)
    setCurrentJobId(null)
  }, [jobStack, isExecuting])

  // Execute a single job using Ralph automation
  const executeSingleJob = async (
    job: JobSpec,
    onProgress: (update: Partial<JobSpec>) => void
  ): Promise<{ success: boolean; error?: string }> => {
    console.log(`[Execute] Starting job: ${job.title}`)
    
    return new Promise((resolve) => {
      // Check if Ralph API is available
      const api = window.electronAPI
      const hasRalph = api && api.ralph && typeof api.ralph.start === 'function'
      console.log(`[Execute] Ralph API available: ${hasRalph}`)
      
      if (hasRalph) {
        let resolved = false
        
        // Set up event listener for progress updates
        window.electronAPI.ralph.onEvent((event) => {
          console.log(`[Execute] Ralph event:`, event)
          if (event.job_id !== job.job_id) return
          
          switch (event.type) {
            case 'iteration':
              onProgress({ 
                iterations_used: event.data.iteration as number,
                currentAction: event.data.action as string || 'Processing...'
              })
              break
            case 'action':
              onProgress({ currentAction: event.data.description as string })
              break
            case 'completed':
            case 'result':
              if (!resolved) {
                resolved = true
                window.electronAPI.ralph.removeEventListener()
                resolve({ success: true })
              }
              break
            case 'error':
              if (!resolved) {
                resolved = true
                window.electronAPI.ralph.removeEventListener()
                resolve({ success: false, error: event.data.message as string })
              }
              break
          }
        })
        
        // Start the Ralph job
        console.log(`[Execute] Calling ralph.start for ${job.job_id}`)
        window.electronAPI.ralph.start({
          job_id: job.job_id,
          title: job.title,
          objective: job.objective,
          estimated_iterations: job.estimated_iterations || 5,
        }).then((result) => {
          console.log(`[Execute] ralph.start returned:`, result)
          if (!result.success && !resolved) {
            resolved = true
            resolve({ success: false, error: result.error || 'Failed to start' })
          }
        }).catch((err) => {
          console.error(`[Execute] ralph.start error:`, err)
          if (!resolved) {
            resolved = true
            resolve({ success: false, error: err.message })
          }
        })
      } else {
        // Fallback: simulate execution for testing
        console.log(`[Execute] Using simulation fallback`)
        let iteration = 0
        const maxIterations = job.estimated_iterations || 5
        
        const simulate = () => {
          iteration++
          console.log(`[Execute] Simulation iteration ${iteration}/${maxIterations}`)
          onProgress({ 
            iterations_used: iteration,
            currentAction: `Iteration ${iteration}: Working on ${job.title}...`
          })
          
          if (iteration >= maxIterations) {
            console.log(`[Execute] Simulation complete`)
            resolve({ success: true })
          } else {
            setTimeout(simulate, 1500)
          }
        }
        
        setTimeout(simulate, 1000)
      }
    })
  }

  // Input mode view
  if (mode === 'input') {
    return (
      <div className="h-screen w-full glass rounded-xl overflow-hidden flex flex-col">
        <TitleBar />
        
        <div className="flex-1 flex flex-col p-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                generateAndOpenBrowser()
              }
            }}
            placeholder="What do you want to build?"
            className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 resize-none focus:outline-none focus:border-white/20 font-mono"
            disabled={isLoading}
          />
          
          {error && (
            <div className="mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
              {error}
            </div>
          )}
          
          <div className="mt-3">
            <button
              onClick={generateAndOpenBrowser}
              disabled={!prompt.trim()}
              className={`w-full py-2 rounded-lg text-xs font-medium transition-all ${
                !prompt.trim()
                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                  : 'bg-white text-black hover:bg-white/90'
              }`}
            >
              Generate Jobs ⌘↵
            </button>
          </div>
          
          <p className="mt-2 text-[10px] text-white/30 text-center">
            Opens browser to review & edit jobs
          </p>
        </div>
      </div>
    )
  }

  // Flow mode view
  return (
    <div className="h-screen w-full glass rounded-xl overflow-hidden flex flex-col">
      <TitleBar onBack={() => setMode('input')} />
      
      <div className="flex-1 overflow-hidden">
        <JobFlowView
          jobStack={jobStack}
          onExecute={executeJobs}
          isExecuting={isExecuting}
          currentJobId={currentJobId}
        />
      </div>
      
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30 text-xs text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}
