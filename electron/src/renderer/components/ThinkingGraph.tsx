import { useCallback, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useLoopStore, type GraphNode as GraphNodeData } from '../stores/loopStore'

const NODE_COLORS: Record<GraphNodeData['type'], string> = {
  input: '#3b82f6',
  observation: '#8b5cf6',
  hypothesis: '#f59e0b',
  fix: '#22c55e',
  validation: '#ef4444',
  memory: '#06b6d4',
  next: '#f97316',
}

function GraphNodeComponent({ data }: { data: { label: string; content: string; nodeType: GraphNodeData['type'] } }) {
  const color = NODE_COLORS[data.nodeType]
  
  return (
    <div 
      className="px-4 py-3 rounded-lg shadow-lg min-w-[150px] max-w-[200px]"
      style={{ 
        backgroundColor: `${color}20`,
        border: `2px solid ${color}`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/50" />
      <div className="text-xs font-medium text-white/60 uppercase mb-1">
        {data.nodeType}
      </div>
      <div className="text-sm font-medium text-white">{data.label}</div>
      {data.content && (
        <div className="text-xs text-white/70 mt-1 line-clamp-2">{data.content}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-white/50" />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  custom: GraphNodeComponent,
}

export function ThinkingGraph() {
  const { iterations, currentIterationId } = useLoopStore()
  
  const currentIteration = useMemo(() => 
    iterations.find(i => i.id === currentIterationId) || iterations[iterations.length - 1],
    [iterations, currentIterationId]
  )

  const { nodes, edges } = useMemo(() => {
    if (!currentIteration || currentIteration.graphNodes.length === 0) {
      // Generate demo nodes if no real data
      return generateDemoGraph(currentIteration)
    }

    const nodes: Node[] = currentIteration.graphNodes.map((n) => ({
      id: n.id,
      type: 'custom',
      position: n.position,
      data: { label: n.label, content: n.content, nodeType: n.type },
    }))

    const edges: Edge[] = currentIteration.graphEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: '#fbbf24', strokeWidth: 2 },
    }))

    return { nodes, edges }
  }, [currentIteration])

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    console.log('Node clicked:', node)
    // TODO: Show node details panel
  }, [])

  if (!currentIteration) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-sm">
        Run a loop to see the thinking graph.
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#333" gap={20} />
        <Controls className="!bg-black/50 !border-white/10" />
      </ReactFlow>
    </div>
  )
}

function generateDemoGraph(iteration: typeof useLoopStore extends (f: infer U) => unknown ? ReturnType<U>['iterations'][0] : never | undefined) {
  if (!iteration) {
    return { nodes: [], edges: [] }
  }

  const nodes: Node[] = [
    {
      id: '1',
      type: 'custom',
      position: { x: 200, y: 0 },
      data: { 
        label: 'Error Input', 
        content: iteration.input.errorOutput.slice(0, 50) + '...', 
        nodeType: 'input' 
      },
    },
    {
      id: '2',
      type: 'custom',
      position: { x: 200, y: 120 },
      data: { 
        label: 'Observations', 
        content: iteration.analysis?.observations?.[0] || 'Analyzing error...', 
        nodeType: 'observation' 
      },
    },
    {
      id: '3',
      type: 'custom',
      position: { x: 200, y: 240 },
      data: { 
        label: 'Hypothesis', 
        content: iteration.analysis?.rootCause || 'Determining root cause...', 
        nodeType: 'hypothesis' 
      },
    },
    {
      id: '4',
      type: 'custom',
      position: { x: 200, y: 360 },
      data: { 
        label: 'Proposed Fix', 
        content: iteration.proposal?.patchStrategy || 'Generating fix...', 
        nodeType: 'fix' 
      },
    },
    {
      id: '5',
      type: 'custom',
      position: { x: 200, y: 480 },
      data: { 
        label: 'Validation', 
        content: iteration.validation?.status || 'Awaiting feedback', 
        nodeType: 'validation' 
      },
    },
  ]

  const edges: Edge[] = [
    { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#fbbf24', strokeWidth: 2 } },
    { id: 'e2-3', source: '2', target: '3', animated: true, style: { stroke: '#fbbf24', strokeWidth: 2 } },
    { id: 'e3-4', source: '3', target: '4', animated: true, style: { stroke: '#fbbf24', strokeWidth: 2 } },
    { id: 'e4-5', source: '4', target: '5', animated: true, style: { stroke: '#fbbf24', strokeWidth: 2 } },
  ]

  return { nodes, edges }
}
