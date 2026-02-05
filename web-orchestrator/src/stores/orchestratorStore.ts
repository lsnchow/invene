/**
 * Orchestrator store - manages task graph state and relay communication.
 */
import { create } from 'zustand';
import type { 
  TaskGraph, 
  TaskNode,
  TaskEdge,
  SliderPreset, 
  NodeState, 
  ExecutionEvent, 
  DocumentInput,
  JobInfo,
} from '@/types';

interface OrchestratorStore {
  // Input state
  userRequest: string;
  documents: DocumentInput[];
  sliders: SliderPreset;
  
  // Graph state
  taskGraph: TaskGraph | null;
  nodeStates: Record<string, NodeState>;
  selectedNodeId: string | null;
  
  // Execution state
  graphId: string | null;
  jobInfo: JobInfo | null;
  isGenerating: boolean;
  isRunning: boolean;
  error: string | null;
  
  // Event log
  events: ExecutionEvent[];
  lastEventId: number | null;
  
  // Actions
  setUserRequest: (request: string) => void;
  setSliders: (sliders: Partial<SliderPreset>) => void;
  addDocument: (doc: DocumentInput) => void;
  removeDocument: (docId: string) => void;
  clearDocuments: () => void;
  
  selectNode: (nodeId: string | null) => void;
  
  generateGraph: () => Promise<void>;
  runInInvene: () => Promise<void>;
  subscribeToEvents: () => void;
  
  reset: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8811/api';

const defaultSliders: SliderPreset = {
  verbosity: 'medium',
  autonomy: 'medium',
  riskTolerance: 'safe',
};

export const useOrchestratorStore = create<OrchestratorStore>((set, get) => ({
  // Initial state
  userRequest: '',
  documents: [],
  sliders: { ...defaultSliders },
  
  taskGraph: null,
  nodeStates: {},
  selectedNodeId: null,
  
  graphId: null,
  jobInfo: null,
  isGenerating: false,
  isRunning: false,
  error: null,
  
  events: [],
  lastEventId: null,
  
  // Actions
  setUserRequest: (request) => set({ userRequest: request }),
  
  setSliders: (newSliders) => set((state) => ({
    sliders: { ...state.sliders, ...newSliders },
  })),
  
  addDocument: (doc) => set((state) => ({
    documents: [...state.documents, doc],
  })),
  
  removeDocument: (docId) => set((state) => ({
    documents: state.documents.filter(d => d.docId !== docId),
  })),
  
  clearDocuments: () => set({ documents: [] }),
  
  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  
  generateGraph: async () => {
    const { userRequest, documents, sliders } = get();
    
    console.log('[DEBUG] generateGraph: Starting with request:', userRequest.slice(0, 50) + '...');
    
    if (!userRequest.trim()) {
      set({ error: 'Please enter a request' });
      return;
    }
    
    // Reset state and start building
    set({ 
      isGenerating: true, 
      error: null,
      taskGraph: null,
      nodeStates: {},
      graphId: null,
    });
    
    try {
      console.log('[DEBUG] generateGraph: Fetching from', `${API_BASE}/graph/generate/stream`);
      const response = await fetch(`${API_BASE}/graph/generate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_request: userRequest,
          documents: documents.map(d => ({
            doc_id: d.docId,
            filename: d.filename,
            extracted_summary: d.extractedSummary,
            chunk_refs: d.chunkRefs,
          })),
          slider_preset: {
            verbosity: sliders.verbosity,
            autonomy: sliders.autonomy,
            risk_tolerance: sliders.riskTolerance,
          },
        }),
      });
      
      console.log('[DEBUG] generateGraph: Response status', response.status);
      
      if (!response.ok) {
        throw new Error(`Failed to generate graph: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      
      const decoder = new TextDecoder();
      let buffer = '';
      let graphId = '';
      let createdAt = '';
      const nodes: TaskNode[] = [];
      const edges: TaskEdge[] = [];
      const nodeStates: Record<string, NodeState> = {};
      
      console.log('[DEBUG] generateGraph: Starting to read stream...');
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[DEBUG] generateGraph: Stream complete');
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          try {
            const event = JSON.parse(line.slice(6));
            console.log('[DEBUG] generateGraph: Got event', event.type, event);
            
            if (event.type === 'start') {
              graphId = event.graph_id;
              createdAt = event.created_at;
              console.log('[DEBUG] generateGraph: Graph started with ID', graphId);
              set({ graphId });
            } else if (event.type === 'node') {
              console.log('[DEBUG] generateGraph: Got node', event.node.node_id, event.node.title);
              const node: TaskNode = {
                nodeId: event.node.node_id,
                title: event.node.title,
                nodeType: event.node.node_type,
                objective: event.node.objective,
                constraints: event.node.constraints,
                successChecks: event.node.success_checks,
                docRefs: event.node.doc_refs,
                dependencies: event.node.dependencies || [],
                ralphProfile: event.node.ralph_profile,
              };
              nodes.push(node);
              nodeStates[node.nodeId] = { status: 'queued' };
              
              console.log('[DEBUG] generateGraph: Total nodes now:', nodes.length);
              
              // Update state with new node immediately
              set({
                taskGraph: {
                  graphId,
                  createdAt,
                  userRequest,
                  sliderPreset: sliders,
                  inputs: { documents },
                  nodes: [...nodes],
                  edges: [...edges],
                },
                nodeStates: { ...nodeStates },
              });
            } else if (event.type === 'edge') {
              console.log('[DEBUG] generateGraph: Got edge', event.edge);
              edges.push({
                fromNodeId: event.edge.from_node_id,
                toNodeId: event.edge.to_node_id,
                edgeType: event.edge.edge_type,
              });
              
              // Update edges
              set((state) => ({
                taskGraph: state.taskGraph ? {
                  ...state.taskGraph,
                  edges: [...edges],
                } : null,
              }));
            } else if (event.type === 'complete') {
              console.log('[DEBUG] generateGraph: Complete! Final nodes:', nodes.length);
              set({ isGenerating: false });
            } else if (event.type === 'error') {
              console.error('[DEBUG] generateGraph: Error event', event.error);
              set({ error: event.error, isGenerating: false });
            }
          } catch (e) {
            console.warn('[DEBUG] generateGraph: Failed to parse SSE event:', e, line);
          }
        }
      }
      
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to generate graph',
        isGenerating: false,
      });
    }
  },
  
  runInInvene: async () => {
    const { taskGraph } = get();
    
    if (!taskGraph) {
      set({ error: 'No task graph to run' });
      return;
    }
    
    set({ isRunning: true, error: null, events: [], lastEventId: null });
    
    try {
      // Create job from task graph
      const response = await fetch(`${API_BASE}/relay/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskgraph: {
            user_request: taskGraph.userRequest,
            slider_preset: {
              verbosity: taskGraph.sliderPreset.verbosity,
              autonomy: taskGraph.sliderPreset.autonomy,
              risk_tolerance: taskGraph.sliderPreset.riskTolerance,
            },
            inputs: taskGraph.inputs,
            nodes: taskGraph.nodes.map(n => ({
              node_id: n.nodeId,
              title: n.title,
              node_type: n.nodeType,
              objective: n.objective,
              constraints: n.constraints,
              success_checks: n.successChecks,
              doc_refs: n.docRefs,
              dependencies: n.dependencies,
              ralph_profile: n.ralphProfile,
            })),
            edges: taskGraph.edges.map(e => ({
              from_node_id: e.fromNodeId,
              to_node_id: e.toNodeId,
              edge_type: e.edgeType,
            })),
          },
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create job: ${response.status}`);
      }
      
      const data = await response.json();
      
      set({
        graphId: data.graph_id,
        jobInfo: {
          jobId: data.job_id,
          graphId: data.graph_id,
          status: 'pending',
        },
      });
      
      // Subscribe to events
      get().subscribeToEvents();
      
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to run in Invene',
        isRunning: false,
      });
    }
  },
  
  subscribeToEvents: () => {
    const { graphId, lastEventId } = get();
    
    if (!graphId) return;
    
    const url = new URL(`${API_BASE}/relay/events/stream/${graphId}`);
    if (lastEventId !== null) {
      url.searchParams.set('since_event_id', String(lastEventId));
    }
    
    const eventSource = new EventSource(url.toString());
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle heartbeat
        if (data.type === 'heartbeat') return;
        
        // Handle stream end
        if (data.type === 'stream_end') {
          eventSource.close();
          set({ isRunning: false });
          return;
        }
        
        // Handle execution event
        const execEvent: ExecutionEvent = {
          eventId: data.event_id,
          graphId: data.graph_id,
          nodeId: data.node_id,
          eventType: data.event_type,
          timestamp: data.timestamp,
          message: data.message,
          artifacts: data.artifacts?.map((a: any) => ({
            type: a.type,
            contentRef: a.content_ref,
          })),
          metrics: data.metrics ? {
            durationMs: data.metrics.duration_ms,
            iterationsUsed: data.metrics.iterations_used,
            tokenEstimate: data.metrics.token_estimate,
          } : undefined,
        };
        
        set((state) => {
          const newEvents = [...state.events, execEvent];
          const newNodeStates = { ...state.nodeStates };
          
          // Update node state if this is a node event
          if (execEvent.nodeId) {
            newNodeStates[execEvent.nodeId] = {
              status: execEvent.eventType as any,
              message: execEvent.message,
              artifacts: execEvent.artifacts,
              metrics: execEvent.metrics,
              updatedAt: execEvent.timestamp,
            };
          }
          
          // Update job info based on event type
          let newJobInfo = state.jobInfo;
          if (execEvent.eventType === 'job_started' && newJobInfo) {
            newJobInfo = { ...newJobInfo, status: 'running' };
          } else if (execEvent.eventType === 'job_completed' && newJobInfo) {
            newJobInfo = { ...newJobInfo, status: 'completed' };
          } else if (execEvent.eventType === 'job_failed' && newJobInfo) {
            newJobInfo = { ...newJobInfo, status: 'failed' };
          }
          
          return {
            events: newEvents,
            nodeStates: newNodeStates,
            lastEventId: execEvent.eventId,
            jobInfo: newJobInfo,
            isRunning: !['job_completed', 'job_failed'].includes(execEvent.eventType),
          };
        });
        
      } catch (e) {
        console.error('Failed to parse event:', e);
      }
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      // Could retry here
    };
  },
  
  reset: () => set({
    taskGraph: null,
    nodeStates: {},
    selectedNodeId: null,
    graphId: null,
    jobInfo: null,
    isGenerating: false,
    isRunning: false,
    error: null,
    events: [],
    lastEventId: null,
  }),
}));
