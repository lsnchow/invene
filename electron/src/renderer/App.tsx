import { useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { CommandDrawer } from './components/CommandDrawer'
import { LoopConsole } from './components/LoopConsole'
import { ThinkingGraph } from './components/ThinkingGraph'
import { useLoopStore } from './stores/loopStore'

type View = 'drawer' | 'console' | 'graph'

export default function App() {
  const [view, setView] = useState<View>('drawer')
  const { iterations } = useLoopStore()

  return (
    <div className="h-screen w-full glass rounded-xl overflow-hidden flex flex-col">
      <TitleBar />
      
      {/* Navigation */}
      <div className="flex border-b border-white/10 px-2">
        <NavButton active={view === 'drawer'} onClick={() => setView('drawer')}>
          ⚡ Command
        </NavButton>
        <NavButton active={view === 'console'} onClick={() => setView('console')}>
          📋 Console {iterations.length > 0 && `(${iterations.length})`}
        </NavButton>
        <NavButton active={view === 'graph'} onClick={() => setView('graph')}>
          🔗 Graph
        </NavButton>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === 'drawer' && <CommandDrawer />}
        {view === 'console' && <LoopConsole />}
        {view === 'graph' && <ThinkingGraph />}
      </div>
    </div>
  )
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors ${
        active 
          ? 'text-lightning-400 border-b-2 border-lightning-400' 
          : 'text-white/60 hover:text-white/80'
      }`}
    >
      {children}
    </button>
  )
}
