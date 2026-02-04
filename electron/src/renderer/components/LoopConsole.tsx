import { useLoopStore } from '../stores/loopStore'

export function LoopConsole() {
  const { iterations, markValidation } = useLoopStore()

  if (iterations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-sm">
        No iterations yet. Run a loop to see results.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin p-4 gap-4">
      {iterations.map((iteration, index) => (
        <div 
          key={iteration.id}
          className="p-4 bg-white/5 border border-white/10 rounded-lg"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lightning-400 font-bold">#{index + 1}</span>
              <span className="text-sm text-white/60">
                {new Date(iteration.timestamp).toLocaleTimeString()}
              </span>
              <span className="px-2 py-0.5 bg-white/10 rounded text-xs text-white/70">
                {iteration.mode}
              </span>
            </div>
            <ValidationBadge status={iteration.validation?.status || 'pending'} />
          </div>

          {/* Analysis */}
          {iteration.analysis && (
            <div className="mb-3">
              <h4 className="text-xs text-white/40 uppercase mb-1">Root Cause</h4>
              <p className="text-sm text-white/80">{iteration.analysis.rootCause}</p>
            </div>
          )}

          {/* Proposal */}
          {iteration.proposal && (
            <div className="mb-3">
              <h4 className="text-xs text-white/40 uppercase mb-1">Plan</h4>
              <p className="text-sm text-white/80 whitespace-pre-wrap">
                {iteration.proposal.plan}
              </p>
            </div>
          )}

          {/* Metrics */}
          {iteration.metrics && (
            <div className="flex gap-4 py-2 border-t border-white/10 mt-2">
              <div className="text-center">
                <div className="text-lg font-bold text-red-400">
                  {iteration.metrics.naiveTokens.toLocaleString()}
                </div>
                <div className="text-xs text-white/40">Naive</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-400">
                  {iteration.metrics.optimizedTokens.toLocaleString()}
                </div>
                <div className="text-xs text-white/40">Optimized</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-lightning-400">
                  -{Math.round((iteration.metrics.savedTokens / iteration.metrics.naiveTokens) * 100)}%
                </div>
                <div className="text-xs text-white/40">Saved</div>
              </div>
            </div>
          )}

          {/* Validation Controls */}
          {iteration.validation?.status === 'pending' && (
            <div className="flex gap-2 mt-3 pt-3 border-t border-white/10">
              <button
                onClick={() => markValidation(iteration.id, 'success', '')}
                className="flex-1 py-2 bg-green-600/30 hover:bg-green-600/50 border border-green-500/30 rounded text-sm text-green-400 transition-colors"
              >
                ✓ Fix Worked
              </button>
              <button
                onClick={() => markValidation(iteration.id, 'failure', '')}
                className="flex-1 py-2 bg-red-600/30 hover:bg-red-600/50 border border-red-500/30 rounded text-sm text-red-400 transition-colors"
              >
                ✗ Still Broken
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ValidationBadge({ status }: { status: 'pending' | 'success' | 'failure' }) {
  const styles = {
    pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    success: 'bg-green-500/20 text-green-400 border-green-500/30',
    failure: 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  const labels = {
    pending: '⏳ Pending',
    success: '✓ Fixed',
    failure: '✗ Failed',
  }

  return (
    <span className={`px-2 py-1 rounded border text-xs ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}
