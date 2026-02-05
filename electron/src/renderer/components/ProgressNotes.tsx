import { useLoopStore, type ProgressNote, type PipelineStage, type RalphIteration } from '../stores/loopStore'
import { useEffect, useRef } from 'react'

const STAGE_LABELS: Record<PipelineStage, string> = {
  // Debug stages
  observation: 'observe',
  intent: 'intent',
  decomposition: 'decompose',
  strategy: 'strategize',
  compilation: 'compile',
  injection: 'inject',
  outcome: 'evaluate',
  decision: 'decide',
  // Product stages
  idea_grounding: 'grounding',
  problem_definition: 'problem',
  user_framing: 'users',
  solution_shaping: 'solution',
  feature_decomposition: 'features',
  system_design: 'architecture',
  risk_analysis: 'risks',
  mvp_definition: 'mvp',
  milestone_planning: 'milestones',
  prd_assembly: 'assembling',
}

export function ProgressNotes() {
  const { notes, isRunning, finalResult, prdOutput, prdVersion, error, pasteToEditor, detectedIntent, ralph } = useLoopStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [notes, ralph.iterations])

  // Show if there's any content to display
  const hasContent = notes.length > 0 || isRunning || finalResult || error || 
    ralph.isRunning || ralph.iterations.length > 0 || ralph.stopReason

  if (!hasContent) {
    return null
  }

  return (
    <div 
      className={`flex flex-col transition-all duration-300 ${
        isRunning || notes.length > 0 || ralph.isRunning || ralph.iterations.length > 0 ? 'flex-1' : 'h-0'
      }`}
    >
      {/* Ralph Loop Header */}
      {(ralph.isRunning || ralph.iterations.length > 0) && (
        <div className="px-3 py-1">
          <span className="text-[9px] text-white/30 uppercase tracking-widest">
            ◎ ralph loop {ralph.isRunning && <span className="animate-pulse">•</span>}
          </span>
          {ralph.objective && (
            <p className="text-[10px] text-white/40 mt-0.5 truncate">{ralph.objective}</p>
          )}
        </div>
      )}

      {/* Intent badge (for non-Ralph modes) */}
      {detectedIntent && !ralph.isRunning && ralph.iterations.length === 0 && (
        <div className="px-3 py-1">
          <span className="text-[9px] text-white/30 uppercase tracking-widest">
            {detectedIntent === 'design_product' ? '◆ design' : '◇ debug'}
          </span>
        </div>
      )}
      
      {/* Nodes */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 scrollbar-thin"
      >
        {/* Ralph Iterations */}
        {ralph.iterations.map((iter) => (
          <RalphIterationItem key={iter.iteration} iteration={iter} />
        ))}

        {/* Ralph current iteration indicator */}
        {ralph.isRunning && ralph.currentIteration > ralph.iterations.length && (
          <div className="node node-running">
            <div className="flex items-center gap-2">
              <span className="node-status-running">◌</span>
              <span className="text-[11px] text-white/60">iteration {ralph.currentIteration}</span>
            </div>
          </div>
        )}

        {/* Ralph Loop Complete */}
        {ralph.stopReason && (
          <div className={`node ${ralph.stopReason === 'success' ? 'node-completed' : 'node-failed'} mt-2`}>
            <div className="flex items-center gap-2">
              <span className={ralph.stopReason === 'success' ? 'node-status-completed' : 'node-status-failed'}>
                {ralph.stopReason === 'success' ? '✓' : '○'}
              </span>
              <span className="text-[11px] text-white/70">
                {ralph.stopReason === 'success' ? 'objective achieved' : ralph.stopReason}
              </span>
            </div>
            {ralph.finalSummary && (
              <p className="text-[10px] text-white/40 mt-1 leading-relaxed pl-4">
                {ralph.finalSummary}
              </p>
            )}
          </div>
        )}

        {/* Regular nodes */}
        {notes.map((note) => (
          <NodeItem key={note.id} note={note} />
        ))}

        {/* PRD Complete with paste button */}
        {prdOutput && (
          <div className="node node-completed mt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="node-status-completed">✓</span>
                <span className="text-[11px] text-white/70">PRD v{prdVersion}</span>
              </div>
              <button
                onClick={pasteToEditor}
                className="px-2 py-0.5 text-[10px] bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white/90 transition-colors"
              >
                paste to editor
              </button>
            </div>
          </div>
        )}

        {/* Final Result (non-PRD) */}
        {finalResult && !prdOutput && (
          <div className="node node-completed mt-2">
            <div className="flex items-center gap-2">
              <span className="node-status-completed">✓</span>
              <span className="text-[11px] text-white/70">complete</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="node node-failed mt-2">
            <div className="flex items-center gap-2">
              <span className="node-status-failed">×</span>
              <span className="text-[11px] text-white/50">{error}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function NodeItem({ note }: { note: ProgressNote }) {
  const label = STAGE_LABELS[note.stage] || note.stage
  
  const nodeClass = {
    pending: 'node-pending',
    running: 'node-running',
    completed: 'node-completed',
    failed: 'node-failed',
  }[note.status]

  const statusIndicator = {
    pending: <span className="node-status-pending">○</span>,
    running: <span className="node-status-running">◌</span>,
    completed: <span className="node-status-completed">●</span>,
    failed: <span className="node-status-failed">×</span>,
  }

  const duration = note.timestampEnd 
    ? ((note.timestampEnd - note.timestampStart) / 1000).toFixed(1) + 's'
    : null

  return (
    <div className={`node ${nodeClass}`}>
      <div className="flex items-center gap-2">
        {statusIndicator[note.status]}
        <span className="text-[11px] text-white/60">{label}</span>
        {duration && (
          <span className="text-[10px] text-white/20 ml-auto">{duration}</span>
        )}
      </div>
      {note.humanSummary && note.status !== 'pending' && (
        <p className="text-[10px] text-white/40 mt-1 leading-relaxed line-clamp-2 pl-4">
          {note.humanSummary}
        </p>
      )}
    </div>
  )
}

function RalphIterationItem({ iteration }: { iteration: RalphIteration }) {
  const outcomeClass = {
    success: 'node-completed',
    failure: 'node-failed',
    timeout: 'node-failed',
    partial: 'node-running',
  }[iteration.outcome]

  const outcomeIndicator = {
    success: <span className="node-status-completed">●</span>,
    failure: <span className="node-status-failed">×</span>,
    timeout: <span className="node-status-failed">⏱</span>,
    partial: <span className="node-status-running">◐</span>,
  }

  const duration = iteration.duration 
    ? (iteration.duration / 1000).toFixed(1) + 's'
    : null

  return (
    <div className={`node ${outcomeClass}`}>
      <div className="flex items-center gap-2">
        {outcomeIndicator[iteration.outcome]}
        <span className="text-[11px] text-white/60">iter {iteration.iteration}</span>
        {duration && (
          <span className="text-[10px] text-white/20 ml-auto">{duration}</span>
        )}
      </div>
      {iteration.action && (
        <p className="text-[10px] text-white/40 mt-1 leading-relaxed line-clamp-1 pl-4">
          {iteration.action}
        </p>
      )}
      {iteration.decision && iteration.decision !== 'continue' && (
        <p className="text-[10px] text-white/30 mt-0.5 pl-4">
          → {iteration.decision}
        </p>
      )}
    </div>
  )
}
