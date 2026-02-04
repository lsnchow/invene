export function TitleBar() {
  const handleMinimize = () => {
    window.electronAPI?.window.minimize()
  }

  const handleClose = () => {
    window.electronAPI?.window.close()
  }

  return (
    <div 
      className="flex items-center justify-between px-4 py-2 bg-black/30"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">⚡</span>
        <span className="text-sm font-semibold text-white">Lightning Loop</span>
      </div>
      
      <div 
        className="flex gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="w-6 h-6 rounded flex items-center justify-center text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        >
          −
        </button>
        <button
          onClick={handleClose}
          className="w-6 h-6 rounded flex items-center justify-center text-white/60 hover:bg-red-500/80 hover:text-white transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  )
}
