'use client';

import { X, FileText, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { useOrchestratorStore } from '@/stores/orchestratorStore';

export function NodeDetails() {
  const { taskGraph, selectedNodeId, nodeStates, selectNode } = useOrchestratorStore();
  
  if (!selectedNodeId || !taskGraph) return null;
  
  const node = taskGraph.nodes.find(n => n.nodeId === selectedNodeId);
  const state = nodeStates[selectedNodeId];
  
  if (!node) return null;
  
  const statusIcon = {
    queued: <Clock className="w-4 h-4 text-white/40" />,
    running: <div className="w-4 h-4 rounded-full bg-blue-500 animate-pulse" />,
    progress: <div className="w-4 h-4 rounded-full bg-blue-500" />,
    done: <CheckCircle className="w-4 h-4 text-green-500" />,
    failed: <XCircle className="w-4 h-4 text-red-500" />,
    blocked: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
    skipped: <Clock className="w-4 h-4 text-white/20" />,
  };
  
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          {statusIcon[state?.status || 'queued']}
          <h3 className="font-medium text-white truncate">{node.title}</h3>
        </div>
        <button 
          onClick={() => selectNode(null)}
          className="p-1 hover:bg-white/10 rounded transition-colors"
        >
          <X className="w-4 h-4 text-white/60" />
        </button>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status */}
        <div>
          <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
            Status
          </label>
          <p className="mt-1 text-sm text-white capitalize">{state?.status || 'queued'}</p>
          {state?.message && (
            <p className="mt-1 text-xs text-white/50">{state.message}</p>
          )}
        </div>
        
        {/* Type */}
        <div>
          <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
            Type
          </label>
          <p className="mt-1 text-sm text-white capitalize">{node.nodeType.replace('_', ' ')}</p>
        </div>
        
        {/* Objective */}
        <div>
          <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
            Objective
          </label>
          <p className="mt-1 text-sm text-white/80">{node.objective}</p>
        </div>
        
        {/* Constraints */}
        {node.constraints && node.constraints.length > 0 && (
          <div>
            <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Constraints
            </label>
            <ul className="mt-1 space-y-1">
              {node.constraints.map((c, i) => (
                <li key={i} className="text-sm text-white/80 flex items-start gap-2">
                  <span className="text-white/40">•</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Success Checks */}
        {node.successChecks && node.successChecks.length > 0 && (
          <div>
            <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Success Criteria
            </label>
            <ul className="mt-1 space-y-1">
              {node.successChecks.map((c, i) => (
                <li key={i} className="text-sm text-white/80 flex items-start gap-2">
                  <CheckCircle className="w-3 h-3 text-white/40 mt-0.5 flex-shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Doc refs */}
        {node.docRefs && node.docRefs.length > 0 && (
          <div>
            <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Document References
            </label>
            <ul className="mt-1 space-y-1">
              {node.docRefs.map((ref, i) => (
                <li key={i} className="text-sm text-white/80 flex items-center gap-2">
                  <FileText className="w-3 h-3 text-white/40" />
                  {ref}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Dependencies */}
        {node.dependencies.length > 0 && (
          <div>
            <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Dependencies
            </label>
            <ul className="mt-1 space-y-1">
              {node.dependencies.map((dep) => {
                const depNode = taskGraph.nodes.find(n => n.nodeId === dep);
                const depState = nodeStates[dep];
                return (
                  <li 
                    key={dep} 
                    className="text-sm text-white/80 flex items-center gap-2 cursor-pointer hover:text-white"
                    onClick={() => selectNode(dep)}
                  >
                    {statusIcon[depState?.status || 'queued']}
                    {depNode?.title || dep}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        
        {/* Artifacts */}
        {state?.artifacts && state.artifacts.length > 0 && (
          <div>
            <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Artifacts
            </label>
            <div className="mt-2 space-y-2">
              {state.artifacts.map((artifact, i) => (
                <div key={i} className="bg-white/5 rounded-md p-2">
                  <p className="text-xs font-medium text-white/80 capitalize mb-1">
                    {artifact.type.replace('_', ' ')}
                  </p>
                  <pre className="text-xs text-white/50 whitespace-pre-wrap overflow-x-auto max-h-40">
                    {artifact.contentRef}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Metrics */}
        {state?.metrics && (
          <div>
            <label className="text-xs font-medium text-white/40 uppercase tracking-wider">
              Metrics
            </label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {state.metrics.durationMs && (
                <div className="bg-white/5 rounded-md p-2">
                  <p className="text-xs text-white/40">Duration</p>
                  <p className="text-sm text-white">{(state.metrics.durationMs / 1000).toFixed(1)}s</p>
                </div>
              )}
              {state.metrics.iterationsUsed && (
                <div className="bg-white/5 rounded-md p-2">
                  <p className="text-xs text-white/40">Iterations</p>
                  <p className="text-sm text-white">{state.metrics.iterationsUsed}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
