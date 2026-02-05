'use client';

import { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';

// ============================================================================
// Types
// ============================================================================

export interface JobSpec {
  job_id: string;
  title: string;
  objective: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  currentAction?: string;
  iterations_used?: number;
  estimated_iterations?: number;
}

export interface JobStackData {
  stack_id: string;
  jobs: JobSpec[];
  execution_order: string[];
  total_jobs: number;
}

interface JobFlowViewProps {
  jobStack: JobStackData | null;
  onExecute: () => void;
  isExecuting: boolean;
  currentJobId: string | null;
}

// ============================================================================
// Custom Node Component
// ============================================================================

function JobNode({ data }: { data: JobSpec & { index: number } }) {
  const statusStyles = {
    pending: 'border-white/20 bg-white/5',
    running: 'border-blue-500 bg-blue-500/20 animate-pulse',
    completed: 'border-green-500 bg-green-500/20',
    failed: 'border-red-500 bg-red-500/20',
  };

  const statusIcons = {
    pending: '○',
    running: '◉',
    completed: '✓',
    failed: '✗',
  };

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 ${statusStyles[data.status]} min-w-[200px] max-w-[280px]`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-white/40">#{data.index + 1}</span>
        <span className={`text-sm ${data.status === 'running' ? 'text-blue-400' : 'text-white/60'}`}>
          {statusIcons[data.status]}
        </span>
        <span className="text-sm font-medium text-white truncate">{data.title}</span>
      </div>
      
      {data.status === 'running' && data.currentAction && (
        <div className="text-xs text-blue-300 mt-1 truncate">
          {data.currentAction}
        </div>
      )}
      
      {data.status === 'running' && data.iterations_used !== undefined && (
        <div className="mt-2">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ 
                width: `${Math.min(100, (data.iterations_used / (data.estimated_iterations || 5)) * 100)}%` 
              }}
            />
          </div>
          <div className="text-xs text-white/40 mt-1">
            Iteration {data.iterations_used}/{data.estimated_iterations || 5}
          </div>
        </div>
      )}
      
      {data.status === 'completed' && (
        <div className="text-xs text-green-400 mt-1">Complete</div>
      )}
      
      {data.status === 'failed' && (
        <div className="text-xs text-red-400 mt-1">Failed</div>
      )}
    </div>
  );
}

const nodeTypes = {
  job: JobNode,
};

// ============================================================================
// Main Component
// ============================================================================

export function JobFlowView({ jobStack, onExecute, isExecuting, currentJobId }: JobFlowViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Convert job stack to React Flow nodes and edges
  useEffect(() => {
    if (!jobStack) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const newNodes: Node[] = jobStack.jobs.map((job, index) => ({
      id: job.job_id,
      type: 'job',
      position: { x: 50, y: index * 120 },
      data: { ...job, index },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }));

    const newEdges: Edge[] = jobStack.jobs.slice(1).map((job, index) => ({
      id: `edge-${index}`,
      source: jobStack.jobs[index].job_id,
      target: job.job_id,
      type: 'smoothstep',
      animated: jobStack.jobs[index].status === 'running',
      style: { stroke: '#444' },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#444',
      },
    }));

    setNodes(newNodes);
    setEdges(newEdges);
  }, [jobStack, setNodes, setEdges]);

  if (!jobStack) {
    return (
      <div className="h-full flex items-center justify-center text-white/40">
        <div className="text-center">
          <div className="text-2xl mb-2">📋</div>
          <div>No jobs queued</div>
          <div className="text-xs mt-1">Open a project from the browser to start</div>
        </div>
      </div>
    );
  }

  const completedCount = jobStack.jobs.filter(j => j.status === 'completed').length;
  const runningJob = jobStack.jobs.find(j => j.status === 'running');

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-white">Job Queue</h2>
          <p className="text-xs text-white/40">
            {completedCount}/{jobStack.total_jobs} completed
          </p>
        </div>
        
        <button
          onClick={onExecute}
          disabled={isExecuting || completedCount === jobStack.total_jobs}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
            isExecuting
              ? 'bg-blue-500/20 text-blue-400 cursor-wait'
              : completedCount === jobStack.total_jobs
              ? 'bg-green-500/20 text-green-400'
              : 'bg-green-500 text-white hover:bg-green-400'
          }`}
        >
          {isExecuting ? (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
              Running...
            </span>
          ) : completedCount === jobStack.total_jobs ? (
            '✓ All Done'
          ) : (
            'Execute'
          )}
        </button>
      </div>

      {/* Current Action Banner */}
      {runningJob && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
          <div className="text-xs text-blue-400">
            <span className="font-medium">Running:</span> {runningJob.title}
          </div>
          {runningJob.currentAction && (
            <div className="text-xs text-blue-300 mt-0.5 truncate">
              {runningJob.currentAction}
            </div>
          )}
        </div>
      )}

      {/* Flow Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#333" gap={20} />
          <Controls className="!bg-black/50 !border-white/10" />
        </ReactFlow>
      </div>
    </div>
  );
}
