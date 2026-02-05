'use client';

import { useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useOrchestratorStore } from '@/stores/orchestratorStore';
import type { TaskNode, NodeStatus } from '@/types';
import { FileText, Terminal, CheckCircle, Search, Database, Package } from 'lucide-react';

// Node type icons
const nodeTypeIcons: Record<string, typeof FileText> = {
  planning: FileText,
  execution: Terminal,
  validation: CheckCircle,
  doc_index: Search,
  memory: Database,
  output: Package,
};

// Status colors
const statusColors: Record<NodeStatus, string> = {
  queued: 'queued',
  running: 'running',
  progress: 'running',
  done: 'done',
  failed: 'failed',
  blocked: 'border-yellow-500',
  skipped: 'border-white/20 opacity-40',
};

// Custom node component
function TaskNodeComponent({ data, selected }: NodeProps) {
  const { selectNode, nodeStates } = useOrchestratorStore();
  const nodeState = nodeStates[data.nodeId];
  const status = nodeState?.status || 'queued';
  
  const Icon = nodeTypeIcons[data.nodeType] || FileText;
  
  return (
    <div
      onClick={() => selectNode(data.nodeId)}
      className={`
        node-card node-appear cursor-pointer
        ${statusColors[status]}
        ${selected ? 'ring-2 ring-white/50' : ''}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/30 !w-2 !h-2" />
      
      <div className="flex items-start gap-2">
        <div className={`
          p-1.5 rounded 
          ${status === 'done' ? 'bg-green-500/20 text-green-400' : 
            status === 'running' || status === 'progress' ? 'bg-blue-500/20 text-blue-400' :
            status === 'failed' ? 'bg-red-500/20 text-red-400' :
            'bg-white/10 text-white/60'}
        `}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{data.title}</p>
          <p className="text-xs text-white/50 capitalize">{data.nodeType}</p>
        </div>
      </div>
      
      {nodeState?.message && (
        <p className="mt-2 text-xs text-white/40 truncate">{nodeState.message}</p>
      )}
      
      <Handle type="source" position={Position.Bottom} className="!bg-white/30 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = {
  taskNode: TaskNodeComponent,
};

export function TaskGraphView() {
  const { taskGraph, nodeStates, selectNode } = useOrchestratorStore();
  
  // Convert TaskGraph to React Flow nodes/edges
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!taskGraph) {
      return { initialNodes: [], initialEdges: [] };
    }
    
    // Calculate node positions using a simple layout algorithm
    const nodeMap = new Map<string, TaskNode>();
    const levels: string[][] = [];
    const nodeLevel = new Map<string, number>();
    
    for (const node of taskGraph.nodes) {
      nodeMap.set(node.nodeId, node);
    }
    
    // Topological sort to determine levels
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    
    for (const node of taskGraph.nodes) {
      inDegree.set(node.nodeId, 0);
      adjacency.set(node.nodeId, []);
    }
    
    for (const node of taskGraph.nodes) {
      for (const dep of node.dependencies) {
        adjacency.get(dep)?.push(node.nodeId);
        inDegree.set(node.nodeId, (inDegree.get(node.nodeId) || 0) + 1);
      }
    }
    
    // BFS to assign levels
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
        nodeLevel.set(nodeId, 0);
      }
    }
    
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const level = nodeLevel.get(nodeId) || 0;
      
      if (!levels[level]) levels[level] = [];
      levels[level].push(nodeId);
      
      for (const neighbor of adjacency.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
          nodeLevel.set(neighbor, level + 1);
        }
      }
    }
    
    // Handle any remaining nodes (cycles or disconnected)
    for (const node of taskGraph.nodes) {
      if (!nodeLevel.has(node.nodeId)) {
        const maxLevel = levels.length;
        nodeLevel.set(node.nodeId, maxLevel);
        if (!levels[maxLevel]) levels[maxLevel] = [];
        levels[maxLevel].push(node.nodeId);
      }
    }
    
    // Create nodes with positions
    const nodes: Node[] = [];
    const nodeWidth = 220;
    const nodeHeight = 100;
    const horizontalGap = 40;
    const verticalGap = 60;
    
    for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
      const levelNodes = levels[levelIdx];
      const levelWidth = levelNodes.length * nodeWidth + (levelNodes.length - 1) * horizontalGap;
      const startX = -levelWidth / 2;
      
      for (let nodeIdx = 0; nodeIdx < levelNodes.length; nodeIdx++) {
        const nodeId = levelNodes[nodeIdx];
        const taskNode = nodeMap.get(nodeId);
        if (!taskNode) continue;
        
        nodes.push({
          id: nodeId,
          type: 'taskNode',
          position: {
            x: startX + nodeIdx * (nodeWidth + horizontalGap),
            y: levelIdx * (nodeHeight + verticalGap),
          },
          data: taskNode,
        });
      }
    }
    
    // Create edges
    const edges: Edge[] = [];
    for (const node of taskGraph.nodes) {
      for (const dep of node.dependencies) {
        edges.push({
          id: `${dep}-${node.nodeId}`,
          source: dep,
          target: node.nodeId,
          animated: nodeStates[node.nodeId]?.status === 'running',
        });
      }
    }
    
    // Also add edges from taskGraph.edges
    for (const edge of taskGraph.edges) {
      const edgeId = `${edge.fromNodeId}-${edge.toNodeId}`;
      if (!edges.find(e => e.id === edgeId)) {
        edges.push({
          id: edgeId,
          source: edge.fromNodeId,
          target: edge.toNodeId,
          animated: nodeStates[edge.toNodeId]?.status === 'running',
          style: edge.edgeType === 'uses_doc' ? { strokeDasharray: '5 5' } : undefined,
        });
      }
    }
    
    return { initialNodes: nodes, initialEdges: edges };
  }, [taskGraph, nodeStates]);
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  
  // Update nodes when taskGraph or nodeStates change
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);
  
  const onNodeClick = useCallback((_: any, node: Node) => {
    selectNode(node.id);
  }, [selectNode]);
  
  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.5}
        maxZoom={1.5}
      >
        <Background color="#333" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
