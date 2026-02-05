// Using consistent logo style with web orchestrator
import logoUrl from '../assets/logo.webp'

interface TitleBarProps {
  onBack?: () => void
}

export function TitleBar({ onBack }: TitleBarProps) {
  const handleMinimize = () => {
    window.electronAPI?.window.minimize()
  }

  const handleClose = () => {
    window.electronAPI?.window.close()
  }

  return (
    <div 
      className="flex items-center justify-between px-4 py-3 border-b border-white/10"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div 
        className="flex items-center gap-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {onBack && (
          <button
            onClick={onBack}
            className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white/60 transition-colors text-xs mr-1"
          >
            ←
          </button>
        )}
        <img src={logoUrl} alt="invene" className="w-7 h-7 rounded-lg" />
        <span className="text-sm font-light text-white tracking-wide">invene</span>
      </div>
      
      <div 
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className="text-[10px] text-white/20 tracking-wider mr-2">⌘⇧L</span>
        <button
          onClick={handleMinimize}
          className="w-5 h-5 rounded flex items-center justify-center text-white/40 hover:bg-white/5 hover:text-white/60 transition-colors text-xs"
        >
          −
        </button>
        <button
          onClick={handleClose}
          className="w-5 h-5 rounded flex items-center justify-center text-white/40 hover:bg-white/5 hover:text-white/60 transition-colors text-xs"
        >
          ×
        </button>
      </div>
    </div>
  )
}
