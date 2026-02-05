'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { PromptInput } from '@/components/PromptInput';
import { SliderPanel } from '@/components/SliderPanel';
import { TaskGraphView } from '@/components/TaskGraphView';
import { NodeDetails } from '@/components/NodeDetails';
import { JobQueue } from '@/components/JobQueue';
import { useOrchestratorStore } from '@/stores/orchestratorStore';

// Dynamically import GL to avoid SSR issues with Three.js
const GL = dynamic(() => import('@/components/gl'), { ssr: false });

export default function Home() {
  const [hovering, setHovering] = useState(false);
  const { 
    taskGraph, 
    selectedNodeId,
    isGenerating,
    isRunning,
    error,
    graphId,
    nodeStates,
  } = useOrchestratorStore();
  
  // Debug logging
  useEffect(() => {
    console.log('[DEBUG] Page: State update', {
      hasTaskGraph: !!taskGraph,
      nodeCount: taskGraph?.nodes.length || 0,
      isGenerating,
      isRunning,
      error,
      graphId,
      nodeStatesCount: Object.keys(nodeStates).length,
    });
  }, [taskGraph, isGenerating, isRunning, error, graphId, nodeStates]);
  
  return (
    <main className="h-screen flex overflow-hidden bg-black relative">
      {/* WebGL Background Animation */}
      <GL hovering={hovering} />
      
      {/* Sidebar */}
      <div className="w-[384px] bg-black/80 backdrop-blur-sm border-r border-white/10 flex flex-col relative z-10">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/logo.webp" alt="invene" className="w-8 h-8 rounded-lg" />
            <h1 className="text-xl font-light text-white tracking-wide">invene</h1>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <PromptInput onHoverChange={setHovering} />
          <SliderPanel />
          
          {/* Job Queue */}
          <JobQueue />
          
          {/* Debug Panel */}
          <div className="p-3 bg-white/5 rounded-lg border border-white/10">
            <div className="text-[10px] text-white/40 space-y-1 font-mono">
              <div>generating: {isGenerating ? '✓' : '✗'}</div>
              <div>running: {isRunning ? '✓' : '✗'}</div>
              <div>graphId: {graphId?.slice(0, 8) || 'none'}</div>
              <div>nodes: {taskGraph?.nodes.length || 0}</div>
              <div>edges: {taskGraph?.edges.length || 0}</div>
              {error && <div className="text-red-400">error: {error}</div>}
            </div>
          </div>
        </div>
        
        {/* Status footer */}
        {(isRunning || error) && (
          <div className="p-4 border-t border-white/10">
            {isRunning && (
              <span className="flex items-center gap-2 text-sm text-white/60">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Executing...
              </span>
            )}
            {error && (
              <span className="text-sm text-red-400">{error}</span>
            )}
          </div>
        )}
      </div>

      {/* Main Content - Graph */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        {taskGraph && taskGraph.nodes.length > 0 ? (
          <TaskGraphView />
        ) : (
          <div className="text-center">
            <p className="text-lg text-white/60 mb-2">
              {isGenerating ? 'Building task graph...' : 'No task graph yet'}
            </p>
            <p className="text-sm text-white/40">
              {isGenerating ? 'Nodes will appear as they are generated' : 'Enter a request and click Build'}
            </p>
            {isGenerating && (
              <div className="mt-4">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mx-auto" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right panel: Node details */}
      {selectedNodeId && (
        <div className="w-80 border-l border-white/10 bg-black/80 backdrop-blur-sm">
          <NodeDetails />
        </div>
      )}
    </main>
  );
}
