import { TitleBar } from './components/TitleBar'
import { InputPanel } from './components/InputPanel'
import { ProgressNotes } from './components/ProgressNotes'

export default function App() {
  return (
    <div className="h-screen w-full glass rounded-xl overflow-hidden flex flex-col">
      <TitleBar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Input Panel - collapses when running */}
        <InputPanel />
        
        {/* Progress Notes - expands when running */}
        <ProgressNotes />
      </div>
    </div>
  )
}
