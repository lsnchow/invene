import { useLoopStore } from '../stores/loopStore'
import { useEffect } from 'react'

export function InputPanel() {
  const { 
    userInput, 
    setUserInput, 
    isRunning, 
    runCommand, 
    startRalphLoop, 
    stopRalphLoop,
    ralph,
    orchestratorJob,
    isPollingOrchestrator,
    checkOrchestratorJobs,
    claimOrchestratorJob,
    startOrchestratorPolling,
    stopOrchestratorPolling,
  } = useLoopStore()
  
  // Start polling on mount with debug logging
  useEffect(() => {
    console.log('[DEBUG] InputPanel: Mounting, starting orchestrator polling')
    startOrchestratorPolling()
    return () => {
      console.log('[DEBUG] InputPanel: Unmounting, stopping orchestrator polling')
      stopOrchestratorPolling()
    }
  }, [startOrchestratorPolling, stopOrchestratorPolling])

  // Log state changes
  useEffect(() => {
    console.log('[DEBUG] InputPanel: State update', { 
      isRunning, 
      isPollingOrchestrator, 
      hasOrchestratorJob: !!orchestratorJob,
      orchestratorJobId: orchestratorJob?.job_id,
      ralphRunning: ralph.isRunning 
    })
  }, [isRunning, isPollingOrchestrator, orchestratorJob, ralph.isRunning])

  const handlePaste = async () => {
    try {
      const text = await window.electronAPI?.clipboard.read()
      if (text) {
        setUserInput(userInput ? `${userInput}\n\n${text}` : text)
      }
    } catch (e) {
      console.error('Failed to paste:', e)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      console.log('[DEBUG] InputPanel: Cmd+Enter pressed, running command')
      runCommand()
    }
    // Ctrl/Cmd+Shift+Enter for Ralph loop
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault()
      console.log('[DEBUG] InputPanel: Cmd+Shift+Enter pressed, starting Ralph loop')
      startRalphLoop(userInput, 'copilot')
    }
  }

  const handleRalphClick = () => {
    console.log('[DEBUG] InputPanel: Ralph button clicked, isRunning:', ralph.isRunning)
    if (ralph.isRunning) {
      stopRalphLoop()
    } else {
      startRalphLoop(userInput, 'copilot')
    }
  }

  return (
    <div className={`flex flex-col transition-all duration-300 ${isRunning ? 'h-20 opacity-50' : 'flex-1'}`}>
      {/* Debug Status Bar */}
      <div className="px-3 py-1 text-[9px] text-white/30 flex gap-2">
        <span>polling: {isPollingOrchestrator ? '✓' : '✗'}</span>
        <span>job: {orchestratorJob ? orchestratorJob.job_id.slice(0, 8) : 'none'}</span>
        <span>running: {isRunning ? '✓' : '✗'}</span>
        <span>ralph: {ralph.isRunning ? '✓' : '✗'}</span>
      </div>
      
      {/* Orchestrator Job Banner */}
      {orchestratorJob && !isRunning && (
        <div className="mx-3 mb-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-blue-400">Task from Web Orchestrator</span>
            <span className="text-[10px] text-blue-400/60">{orchestratorJob.taskgraph?.nodes?.length || 0} nodes</span>
          </div>
          <p className="text-xs text-white/80 mb-2 line-clamp-2">{orchestratorJob.taskgraph?.user_request || 'Unknown request'}</p>
          <button
            onClick={() => {
              console.log('[DEBUG] InputPanel: Execute Task Graph clicked', orchestratorJob.job_id)
              claimOrchestratorJob(orchestratorJob.job_id)
            }}
            className="w-full py-1.5 bg-blue-500/80 text-white text-xs rounded hover:bg-blue-500 transition-colors"
          >
            Execute Task Graph
          </button>
        </div>
      )}
      
      {/* Input Area */}
      <div className="flex-1 px-3 py-2">
        <div className="relative h-full">
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="orchestra from a seed"
            disabled={isRunning}
            className="w-full h-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/25 resize-none focus:outline-none focus:border-white/20 disabled:opacity-50 leading-relaxed font-mono"
          />
          {!isRunning && (
            <button
              onClick={handlePaste}
              className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px] text-white/30 hover:text-white/60 hover:bg-white/5 rounded transition-colors"
            >
              paste
            </button>
          )}
        </div>
      </div>

      {/* Buttons Row */}
      <div className="px-3 pb-3 flex gap-2">
        {/* Build Button */}
        <button
          onClick={() => {
            console.log('[DEBUG] InputPanel: Build button clicked')
            runCommand()
          }}
          disabled={isRunning || !userInput.trim()}
          className={`flex-1 py-2 rounded-lg font-medium text-xs tracking-wide transition-all ${
            isRunning || !userInput.trim()
              ? 'bg-white/5 text-white/20 cursor-not-allowed'
              : 'bg-white/90 text-black hover:bg-white active:scale-[0.98]'
          }`}
        >
          {isRunning && !ralph.isRunning ? (
            <span className="flex items-center justify-center gap-1.5">
              <span className="w-3 h-3 border border-black/30 border-t-transparent rounded-full animate-spin" />
              building...
            </span>
          ) : (
            'Build'
          )}
        </button>

        {/* Ralph Loop Button */}
        <button
          onClick={handleRalphClick}
          disabled={!ralph.isRunning && (!userInput.trim() || isRunning)}
          className={`px-4 py-2 rounded-lg font-medium text-xs tracking-wide transition-all ${
            ralph.isRunning
              ? 'bg-red-500/80 text-white hover:bg-red-500 active:scale-[0.98]'
              : !userInput.trim() || isRunning
              ? 'bg-white/5 text-white/20 cursor-not-allowed'
              : 'bg-blue-500/80 text-white hover:bg-blue-500 active:scale-[0.98]'
          }`}
          title="Ralph Loop - Autonomous iteration via Copilot"
        >
          {ralph.isRunning ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border border-white/50 border-t-transparent rounded-full animate-spin" />
              Stop
            </span>
          ) : (
            '🔄 Loop'
          )}
        </button>
      </div>
    </div>
  )
}
