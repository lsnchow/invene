/**
 * Type definitions for the Web Orchestrator.
 * Matches PRD data contracts.
 */

// Slider presets
export interface SliderPreset {
  verbosity: 'low' | 'medium' | 'high';
  autonomy: 'low' | 'medium' | 'high';
  riskTolerance: 'safe' | 'aggressive';
}

// Document reference
export interface DocumentRef {
  docId: string;
  filename: string;
  extractedSummary?: string;
  chunkRefs?: string[];
}

// Document input
export interface DocumentInput {
  docId: string;
  filename: string;
  extractedSummary?: string;
  chunkRefs?: string[];
}

// Task node
export interface TaskNode {
  nodeId: string;
  title: string;
  nodeType: 'planning' | 'execution' | 'validation' | 'doc_index' | 'memory' | 'output';
  objective: string;
  constraints?: string[];
  successChecks?: string[];
  docRefs?: string[];
  dependencies: string[];
  ralphProfile?: string;
}

// Task edge
export interface TaskEdge {
  fromNodeId: string;
  toNodeId: string;
  edgeType: 'depends_on' | 'uses_doc' | 'produces_artifact';
}

// Full TaskGraph
export interface TaskGraph {
  graphId: string;
  createdAt: string;
  userRequest: string;
  sliderPreset: SliderPreset;
  inputs: {
    documents?: DocumentInput[];
  };
  nodes: TaskNode[];
  edges: TaskEdge[];
}

// Node status (from events)
export type NodeStatus = 'queued' | 'running' | 'progress' | 'done' | 'failed' | 'blocked' | 'skipped';

// Artifact
export interface Artifact {
  type: 'log_summary' | 'plan' | 'patch' | 'prd_section' | 'command' | 'diff_summary';
  contentRef: string;
}

// Metrics
export interface Metrics {
  durationMs?: number;
  iterationsUsed?: number;
  tokenEstimate?: number;
}

// Execution event
export interface ExecutionEvent {
  eventId: number;
  graphId: string;
  nodeId?: string;
  eventType: NodeStatus | 'job_started' | 'job_completed' | 'job_failed';
  timestamp: string;
  message?: string;
  artifacts?: Artifact[];
  metrics?: Metrics;
}

// Node state (combined status from events)
export interface NodeState {
  status: NodeStatus;
  message?: string;
  artifacts?: Artifact[];
  metrics?: Metrics;
  updatedAt?: string;
}

// Job info
export interface JobInfo {
  jobId: string;
  graphId: string;
  status: 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentNodeId?: string;
  currentNodeIndex?: number;
}

// Graph state response
export interface GraphStateResponse {
  graphId: string;
  createdAt: string;
  userRequest: string;
  taskgraph: TaskGraph;
  sliders: {
    verbosity: string;
    autonomy: string;
    riskTolerance: string;
  };
  stats: {
    totalNodes: number;
    completedNodes: number;
    failedNodes: number;
  };
  job?: JobInfo;
  nodeStatuses: Record<string, NodeState>;
}
