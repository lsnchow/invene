/**
 * Remote Job Listener for Web Orchestrator integration.
 * 
 * Polls the relay for pending jobs, executes TaskGraph nodes
 * via Ralph Loops, and reports execution events back to the relay.
 */
import { BrowserWindow, ipcMain } from 'electron';

interface TaskNode {
  node_id: string;
  title: string;
  node_type: string;
  objective: string;
  constraints?: string[];
  success_checks?: string[];
  doc_refs?: string[];
  dependencies: string[];
  ralph_profile?: string;
}

interface TaskGraph {
  graph_id: string;
  user_request: string;
  nodes: TaskNode[];
  edges: Array<{
    from_node_id: string;
    to_node_id: string;
    edge_type: string;
  }>;
}

interface Job {
  job_id: string;
  graph_id: string;
  status: string;
  taskgraph: TaskGraph;
  current_node_id?: string;
  current_node_index: number;
}

interface RemoteJobListenerConfig {
  relayUrl: string;
  instanceId: string;
  pollIntervalMs: number;
  enabled: boolean;
}

const defaultConfig: RemoteJobListenerConfig = {
  relayUrl: 'http://localhost:8811/api',
  instanceId: `invene-${Date.now()}`,
  pollIntervalMs: 2000,
  enabled: false,
};

let config = { ...defaultConfig };
let isPolling = false;
let currentJob: Job | null = null;
let pollInterval: NodeJS.Timeout | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Initialize the remote job listener.
 */
export function initRemoteJobListener(window: BrowserWindow): void {
  mainWindow = window;
  
  // IPC handlers for renderer to control the listener
  ipcMain.handle('remote-job:get-status', () => ({
    enabled: config.enabled,
    isPolling,
    currentJob: currentJob ? {
      job_id: currentJob.job_id,
      graph_id: currentJob.graph_id,
      status: currentJob.status,
    } : null,
  }));
  
  ipcMain.handle('remote-job:set-enabled', (_event, enabled: boolean) => {
    config.enabled = enabled;
    if (enabled && !isPolling) {
      startPolling();
    } else if (!enabled && isPolling) {
      stopPolling();
    }
    return { enabled: config.enabled };
  });
  
  ipcMain.handle('remote-job:set-relay-url', (_event, url: string) => {
    config.relayUrl = url;
    return { relayUrl: config.relayUrl };
  });
  
  console.log('[RemoteJobListener] Initialized');
}

/**
 * Start polling for jobs.
 */
function startPolling(): void {
  if (isPolling) return;
  
  isPolling = true;
  console.log('[RemoteJobListener] Started polling for jobs');
  
  pollInterval = setInterval(async () => {
    if (!config.enabled || currentJob) return;
    
    try {
      await pollForJob();
    } catch (error) {
      console.error('[RemoteJobListener] Poll error:', error);
    }
  }, config.pollIntervalMs);
  
  // Immediate first poll
  pollForJob().catch(console.error);
}

/**
 * Stop polling for jobs.
 */
function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  isPolling = false;
  console.log('[RemoteJobListener] Stopped polling');
}

/**
 * Poll the relay for the next pending job.
 */
async function pollForJob(): Promise<void> {
  if (currentJob) return;
  
  try {
    const response = await fetch(`${config.relayUrl}/relay/jobs/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimed_by: config.instanceId }),
    });
    
    if (!response.ok) {
      if (response.status !== 200) {
        console.debug('[RemoteJobListener] No pending jobs');
      }
      return;
    }
    
    const job = await response.json() as Job;
    if (!job || !job.job_id) return;
    
    console.log(`[RemoteJobListener] Claimed job ${job.job_id}`);
    currentJob = job;
    
    // Notify renderer
    mainWindow?.webContents.send('remote-job:claimed', job);
    
    // Execute the job
    await executeJob(job);
    
  } catch (error) {
    console.error('[RemoteJobListener] Failed to poll for jobs:', error);
  }
}

/**
 * Execute a job by running each node through Ralph Loops.
 */
async function executeJob(job: Job): Promise<void> {
  const { graph_id, job_id, taskgraph } = job;
  
  try {
    // Mark job as started
    await fetch(`${config.relayUrl}/relay/jobs/${job_id}/start`, {
      method: 'POST',
    });
    
    // Topologically sort nodes
    const sortedNodes = topologicalSort(taskgraph.nodes, taskgraph.edges);
    
    console.log(`[RemoteJobListener] Executing ${sortedNodes.length} nodes`);
    
    // Execute nodes sequentially
    for (let i = 0; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      
      // Update progress
      await fetch(`${config.relayUrl}/relay/jobs/${job_id}/progress?node_id=${node.node_id}&node_index=${i}`, {
        method: 'POST',
      });
      
      // Emit queued event
      await postEvent(graph_id, node.node_id, 'queued', `Queued: ${node.title}`);
      
      // Check if this is a planning node (can run in parallel later)
      const isPlanningNode = ['planning', 'doc_index'].includes(node.node_type);
      
      // Emit running event
      await postEvent(graph_id, node.node_id, 'running', `Running: ${node.title}`);
      
      // Notify renderer to start Ralph loop for this node
      mainWindow?.webContents.send('remote-job:node-start', {
        graph_id,
        job_id,
        node,
        node_index: i,
      });
      
      // Execute the node via Ralph Loop
      const result = await executeNode(node, graph_id);
      
      if (result.success) {
        await postEvent(graph_id, node.node_id, 'done', `Completed: ${node.title}`, result.artifacts, result.metrics);
      } else {
        await postEvent(graph_id, node.node_id, 'failed', result.error || `Failed: ${node.title}`);
        
        // Don't fail the whole job on node failure - mark as failed and continue
        // (can change to fail-fast if needed)
        console.warn(`[RemoteJobListener] Node ${node.node_id} failed: ${result.error}`);
      }
      
      // Notify renderer
      mainWindow?.webContents.send('remote-job:node-complete', {
        graph_id,
        job_id,
        node_id: node.node_id,
        success: result.success,
        result,
      });
    }
    
    // Mark job as completed
    await fetch(`${config.relayUrl}/relay/jobs/${job_id}/complete`, {
      method: 'POST',
    });
    
    console.log(`[RemoteJobListener] Job ${job_id} completed`);
    mainWindow?.webContents.send('remote-job:completed', { graph_id, job_id });
    
  } catch (error) {
    console.error(`[RemoteJobListener] Job ${job_id} failed:`, error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    await fetch(`${config.relayUrl}/relay/jobs/${job_id}/fail?error_message=${encodeURIComponent(errorMessage)}`, {
      method: 'POST',
    });
    
    mainWindow?.webContents.send('remote-job:failed', { graph_id, job_id, error: errorMessage });
    
  } finally {
    currentJob = null;
  }
}

/**
 * Execute a single TaskGraph node via Ralph Loop.
 */
async function executeNode(
  node: TaskNode,
  graph_id: string
): Promise<{ success: boolean; error?: string; artifacts?: any[]; metrics?: any }> {
  const startTime = Date.now();
  
  try {
    // Build the objective with constraints
    let objective = node.objective;
    if (node.constraints && node.constraints.length > 0) {
      objective += `\n\nConstraints:\n${node.constraints.map(c => `- ${c}`).join('\n')}`;
    }
    if (node.success_checks && node.success_checks.length > 0) {
      objective += `\n\nSuccess criteria:\n${node.success_checks.map(s => `- ${s}`).join('\n')}`;
    }
    
    // Determine actuator based on node type
    const actuator = node.node_type === 'execution' ? 'terminal' : 'copilot';
    
    // Call the Ralph Loop API
    const response = await fetch('http://localhost:8811/api/ralph/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective,
        actuator,
        max_iterations: 10,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Ralph API error: ${response.status}`);
    }
    
    // Process SSE stream and wait for completion
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }
    
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: any = null;
    let lastIteration: any = null;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        
        try {
          const data = JSON.parse(line.slice(6));
          
          if (data.type === 'iteration_end') {
            lastIteration = data;
            
            // Post progress event
            await postEvent(graph_id, node.node_id, 'progress', 
              `Iteration ${data.iteration}: ${data.outcome}`,
              data.result ? [{ type: 'log_summary', content_ref: data.result.substring(0, 500) }] : undefined,
              { iterations_used: data.iteration, duration_ms: Date.now() - startTime }
            );
          }
          
          if (data.type === 'loop_complete') {
            finalResult = data;
          }
          
        } catch (e) {
          // Ignore parse errors for heartbeats etc
        }
      }
    }
    
    const duration = Date.now() - startTime;
    
    return {
      success: finalResult?.stop_reason === 'success' || lastIteration?.outcome === 'success',
      artifacts: finalResult?.final_summary 
        ? [{ type: 'log_summary', content_ref: finalResult.final_summary }]
        : undefined,
      metrics: {
        duration_ms: duration,
        iterations_used: finalResult?.iterations || lastIteration?.iteration || 0,
      },
    };
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metrics: { duration_ms: Date.now() - startTime },
    };
  }
}

/**
 * Post an execution event to the relay.
 */
async function postEvent(
  graph_id: string,
  node_id: string,
  event_type: string,
  message: string,
  artifacts?: any[],
  metrics?: any
): Promise<void> {
  try {
    await fetch(`${config.relayUrl}/relay/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph_id,
        node_id,
        event_type,
        message,
        artifacts,
        metrics,
      }),
    });
  } catch (error) {
    console.error('[RemoteJobListener] Failed to post event:', error);
  }
}

/**
 * Topologically sort nodes based on dependencies.
 */
function topologicalSort(nodes: TaskNode[], edges: Array<{ from_node_id: string; to_node_id: string; edge_type?: string }>): TaskNode[] {
  const nodeMap = new Map(nodes.map(n => [n.node_id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  
  // Initialize
  for (const node of nodes) {
    inDegree.set(node.node_id, 0);
    adjacency.set(node.node_id, []);
  }
  
  // Build graph from edges
  for (const edge of edges) {
    if (edge.edge_type === 'depends_on') {
      adjacency.get(edge.from_node_id)?.push(edge.to_node_id);
      inDegree.set(edge.to_node_id, (inDegree.get(edge.to_node_id) || 0) + 1);
    }
  }
  
  // Also use node.dependencies
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (nodeMap.has(dep)) {
        adjacency.get(dep)?.push(node.node_id);
        inDegree.set(node.node_id, (inDegree.get(node.node_id) || 0) + 1);
      }
    }
  }
  
  // Kahn's algorithm
  const queue: string[] = [];
  const sorted: TaskNode[] = [];
  
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }
  
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (node) {
      sorted.push(node);
    }
    
    for (const neighbor of adjacency.get(nodeId) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }
  
  // If not all nodes are sorted, there's a cycle - add remaining in original order
  if (sorted.length < nodes.length) {
    for (const node of nodes) {
      if (!sorted.includes(node)) {
        sorted.push(node);
      }
    }
  }
  
  return sorted;
}

export { config as remoteJobConfig };
