"use client";

import { useState } from "react";
import { GL } from "./gl";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Slider } from "./ui/slider";
import { Sparkles, Upload } from "lucide-react";

export function BeanOrchestrator() {
  const [hovering, setHovering] = useState(false);
  const [input, setInput] = useState("");
  const [verbosity, setVerbosity] = useState([50]);
  const [autonomy, setAutonomy] = useState([50]);
  const [riskTolerance, setRiskTolerance] = useState([0]);

  const getVerbosityLabel = (value: number) => {
    if (value < 33) return "Low";
    if (value < 66) return "Medium";
    return "High";
  };

  const getAutonomyLabel = (value: number) => {
    if (value < 33) return "Ask";
    if (value < 66) return "Balance";
    return "Assume";
  };

  const getRiskToleranceLabel = (value: number) => {
    if (value < 50) return "Safe";
    return "Aggressive";
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <GL hovering={hovering} />

      {/* Sidebar */}
      <div className="w-[384px] bg-black/80 backdrop-blur-sm border-r border-foreground/10 flex flex-col relative z-10">
        {/* Header */}
        <div className="p-6 border-b border-foreground/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-foreground/10 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-foreground/60" />
            </div>
            <h1 className="text-xl font-sentient font-light">Invene Orchestrator</h1>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Input Section */}
          <div className="space-y-3">
            <label className="text-sm font-medium">
              What do you want to build?
            </label>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Make an app. Add OAuth. Make a landing page. Add local DB."
              className="min-h-[140px]"
            />
          </div>

          {/* Upload PDFs */}
          <button className="flex items-center gap-2 text-sm text-foreground/60 hover:text-foreground/80 transition-colors">
            <Upload className="w-4 h-4" />
            <span>Upload PDFs (optional)</span>
          </button>

          {/* Generate Button */}
          <Button
            className="w-full"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
          >
            <Sparkles className="w-4 h-4" />
            Generate Graph
          </Button>

          {/* Tuning Section */}
          <div className="pt-6 space-y-6 border-t border-foreground/10">
            <h2 className="text-xs font-mono uppercase tracking-wider text-foreground/60">
              Tuning
            </h2>

            {/* Verbosity */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Verbosity</label>
                <span className="text-sm text-foreground/60">
                  {getVerbosityLabel(verbosity[0])}
                </span>
              </div>
              <Slider
                value={verbosity}
                onValueChange={setVerbosity}
                max={100}
                step={1}
              />
              <p className="text-xs text-foreground/40">
                Low = 3-6 nodes, High = 12-25 detailed subtasks
              </p>
            </div>

            {/* Autonomy */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Autonomy</label>
                <span className="text-sm text-foreground/60">
                  {getAutonomyLabel(autonomy[0])}
                </span>
              </div>
              <Slider
                value={autonomy}
                onValueChange={setAutonomy}
                max={100}
                step={1}
              />
              <p className="text-xs text-foreground/40">
                Ask = add clarification nodes, Assume = proceed with assumptions
              </p>
            </div>

            {/* Risk Tolerance */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Risk Tolerance</label>
                <span className="text-sm text-foreground/60">
                  {getRiskToleranceLabel(riskTolerance[0])}
                </span>
              </div>
              <Slider
                value={riskTolerance}
                onValueChange={setRiskTolerance}
                max={100}
                step={1}
              />
              <p className="text-xs text-foreground/40">
                Safe = more validation nodes, Aggressive = faster execution
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        <div className="text-center">
          <p className="text-lg text-foreground/60 mb-2">No task graph yet</p>
          <p className="text-sm text-foreground/40">
            Enter a request and click Generate
          </p>
        </div>
      </div>
    </div>
  );
}
