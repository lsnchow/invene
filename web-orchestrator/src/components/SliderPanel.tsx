'use client';

import * as Slider from '@radix-ui/react-slider';
import { useOrchestratorStore } from '@/stores/orchestratorStore';

const verbosityLabels = ['Low', 'Medium', 'High'];
const autonomyLabels = ['Ask', 'Balance', 'Assume'];
const riskLabels = ['Safe', 'Aggressive'];

function SliderControl({
  label,
  description,
  value,
  onChange,
  labels,
  max,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  labels: string[];
  max: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-white">{label}</label>
        <span className="text-sm text-white/60">{labels[value]}</span>
      </div>
      <Slider.Root
        className="relative flex items-center select-none touch-none w-full h-5"
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        max={max}
        step={1}
      >
        <Slider.Track className="bg-white/20 relative grow rounded-full h-1">
          <Slider.Range className="absolute bg-white/40 rounded-full h-full" />
        </Slider.Track>
        <Slider.Thumb className="block w-4 h-4 bg-black border border-white/50 rounded-full shadow transition-colors focus:outline-none focus:ring-1 focus:ring-white/50" />
      </Slider.Root>
      <p className="text-xs text-white/40">{description}</p>
    </div>
  );
}

export function SliderPanel() {
  const { sliders, setSliders } = useOrchestratorStore();
  
  // Convert string values to indices
  const verbosityIndex = { low: 0, medium: 1, high: 2 }[sliders.verbosity];
  const autonomyIndex = { low: 0, medium: 1, high: 2 }[sliders.autonomy];
  const riskIndex = { safe: 0, aggressive: 1 }[sliders.riskTolerance];
  
  return (
    <div className="pt-6 space-y-6 border-t border-white/10">
      <h2 className="text-xs font-mono uppercase tracking-wider text-white/60">
        Tuning
      </h2>
      
      <SliderControl
        label="Verbosity"
        description="Low = 3-6 nodes, High = 12-25 detailed subtasks"
        value={verbosityIndex}
        onChange={(v) => setSliders({ verbosity: ['low', 'medium', 'high'][v] as any })}
        labels={verbosityLabels}
        max={2}
      />
      
      <SliderControl
        label="Autonomy"
        description="Ask = add clarification nodes, Assume = proceed with assumptions"
        value={autonomyIndex}
        onChange={(v) => setSliders({ autonomy: ['low', 'medium', 'high'][v] as any })}
        labels={autonomyLabels}
        max={2}
      />
      
      <SliderControl
        label="Risk Tolerance"
        description="Safe = more validation nodes, Aggressive = faster execution"
        value={riskIndex}
        onChange={(v) => setSliders({ riskTolerance: ['safe', 'aggressive'][v] as any })}
        labels={riskLabels}
        max={1}
      />
    </div>
  );
}
