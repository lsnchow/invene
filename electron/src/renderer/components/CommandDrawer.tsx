import { useState } from 'react'
import { useLoopStore, type LoopMode } from '../stores/loopStore'

const MODES: { id: LoopMode; label: string; icon: string }[] = [
  { id: 'fix-error', label: 'Fix Error', icon: '🔧' },
  { id: 'make-tests-pass', label: 'Make Tests Pass', icon: '✅' },
  { id: 'refactor', label: 'Refactor', icon: '♻️' },
  { id: 'explain', label: 'Explain Failure', icon: '💡' },
]

export function CommandDrawer() {
  const { 
    currentMode, 
    currentInput, 
    isLoading, 
    error,
    iterations,
    setMode, 
    setInput, 
    runLoop 
  } = useLoopStore()

  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  const handlePasteFromClipboard = async () => {
    try {
      const text = await window.electronAPI?.clipboard.read()
      if (text) {
        setInput({ errorOutput: text })
      }
    } catch (e) {
      console.error('Failed to read clipboard:', e)
    }
  }

  const handleCopyPrompt = async () => {
    const latestIteration = iterations[iterations.length - 1]
    if (latestIteration?.proposal?.optimizedPrompt) {
      await window.electronAPI?.clipboard.write(latestIteration.proposal.optimizedPrompt)
      setCopyStatus('Copied!')
      setTimeout(() => setCopyStatus(null), 2000)
    }
  }

  const handlePasteToEditor = async (editor: 'vscode' | 'cursor') => {
    const latestIteration = iterations[iterations.length - 1]
    if (latestIteration?.proposal?.optimizedPrompt) {
      await window.electronAPI?.clipboard.write(latestIteration.proposal.optimizedPrompt)
      await window.electronAPI?.automation.pasteToEditor(editor)
      setCopyStatus(`Pasted to ${editor === 'vscode' ? 'VS Code' : 'Cursor'}!`)
      setTimeout(() => setCopyStatus(null), 2000)
    }
  }

  const latestProposal = iterations[iterations.length - 1]?.proposal

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto scrollbar-thin">
      {/* Mode Selector */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => setMode(mode.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              currentMode === mode.id
                ? 'bg-lightning-500 text-black'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            <span className="mr-2">{mode.icon}</span>
            {mode.label}
          </button>
        ))}
      </div>

      {/* Error Output Input */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-white/60">Error Output</label>
          <button
            onClick={handlePasteFromClipboard}
            className="text-xs text-lightning-400 hover:text-lightning-300"
          >
            📋 Paste from clipboard
          </button>
        </div>
        <textarea
          value={currentInput.errorOutput}
          onChange={(e) => setInput({ errorOutput: e.target.value })}
          placeholder="Paste your error output, stack trace, or test failures here..."
          className="w-full h-32 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-lightning-500/50"
        />
      </div>

      {/* Context Input */}
      <div className="mb-4">
        <label className="text-sm text-white/60 mb-2 block">Additional Context (optional)</label>
        <textarea
          value={currentInput.context}
          onChange={(e) => setInput({ context: e.target.value })}
          placeholder="Recent changes, constraints, or relevant code..."
          className="w-full h-20 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-lightning-500/50"
        />
      </div>

      {/* Language & Project */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-sm text-white/60 mb-2 block">Language</label>
          <select
            value={currentInput.language}
            onChange={(e) => setInput({ language: e.target.value })}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-lightning-500/50"
          >
            <option value="python">Python</option>
            <option value="typescript">TypeScript</option>
            <option value="javascript">JavaScript</option>
            <option value="rust">Rust</option>
            <option value="go">Go</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-white/60 mb-2 block">Project Path</label>
          <input
            type="text"
            value={currentInput.projectPath}
            onChange={(e) => setInput({ projectPath: e.target.value })}
            placeholder="/path/to/project"
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-lightning-500/50"
          />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Run Button */}
      <button
        onClick={runLoop}
        disabled={isLoading || !currentInput.errorOutput.trim()}
        className={`w-full py-3 rounded-lg font-semibold text-sm transition-all ${
          isLoading || !currentInput.errorOutput.trim()
            ? 'bg-white/10 text-white/30 cursor-not-allowed'
            : 'bg-lightning-500 text-black hover:bg-lightning-400'
        }`}
      >
        {isLoading ? '⚡ Analyzing...' : '⚡ Run Loop'}
      </button>

      {/* Result Preview */}
      {latestProposal && (
        <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-white">Generated Prompt</span>
            {copyStatus && (
              <span className="text-xs text-lightning-400">{copyStatus}</span>
            )}
          </div>
          
          <p className="text-xs text-white/60 mb-3 line-clamp-3">
            {latestProposal.optimizedPrompt.slice(0, 200)}...
          </p>

          <div className="flex gap-2">
            <button
              onClick={handleCopyPrompt}
              className="flex-1 py-2 bg-white/10 hover:bg-white/20 rounded text-sm text-white transition-colors"
            >
              📋 Copy
            </button>
            <button
              onClick={() => handlePasteToEditor('vscode')}
              className="flex-1 py-2 bg-blue-600/80 hover:bg-blue-600 rounded text-sm text-white transition-colors"
            >
              VS Code
            </button>
            <button
              onClick={() => handlePasteToEditor('cursor')}
              className="flex-1 py-2 bg-purple-600/80 hover:bg-purple-600 rounded text-sm text-white transition-colors"
            >
              Cursor
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
