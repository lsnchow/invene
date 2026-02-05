/**
 * Ralph Loop Runner - Bridges Electron to Python Ralph execution
 * 
 * This module spawns Python subprocesses to run Ralph loops and streams
 * events back to the renderer via IPC.
 */
import { BrowserWindow, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';

// Track active Ralph processes
const activeProcesses: Map<string, {
  process: ChildProcess;
  jobId: string;
  status: 'running' | 'stopping' | 'stopped';
}> = new Map();

// Python executable - use full path to avoid PATH issues in Electron
const PYTHON_PATH = '/usr/bin/python3';

// Hardcode the project root since path resolution with special characters is problematic
const PROJECT_ROOT = '/Users/lucas/Desktop/copilot^squared';

// Find the Ralph directory (relative to the project root)
function getRalphPath(): string {
  return path.join(PROJECT_ROOT, 'ralph');
}

interface RalphJobSpec {
  job_id: string;
  title: string;
  objective: string;
  scope_included: string[];
  scope_excluded: string[];
  constraints: string[];
  success_criteria: string[];
  verification_commands: string[];
  estimated_iterations: number;
}

interface RalphEvent {
  type: 'started' | 'iteration' | 'action' | 'decision' | 'completed' | 'error' | 'log';
  job_id: string;
  data: Record<string, unknown>;
}

/**
 * Initialize Ralph IPC handlers
 */
export function initRalphRunner(mainWindow: BrowserWindow): void {
  console.log('[RalphRunner] Initializing...');
  
  // Start Ralph loop for a job
  ipcMain.handle('ralph:start', async (_event, job: RalphJobSpec) => {
    return startRalphLoop(mainWindow, job);
  });
  
  // Stop Ralph loop
  ipcMain.handle('ralph:stop', async (_event, jobId: string) => {
    return stopRalphLoop(jobId);
  });
  
  // Get status of all active loops
  ipcMain.handle('ralph:status', async () => {
    return getActiveLoopStatus();
  });
  
  console.log('[RalphRunner] IPC handlers registered');
}

/**
 * Start a Ralph loop for the given job spec
 */
async function startRalphLoop(mainWindow: BrowserWindow, job: RalphJobSpec): Promise<{
  success: boolean;
  job_id: string;
  error?: string;
}> {
  console.log(`[RalphRunner] Starting loop for job: ${job.job_id}`);
  
  // Check if already running
  if (activeProcesses.has(job.job_id)) {
    console.log(`[RalphRunner] Job ${job.job_id} already running`);
    return { success: false, job_id: job.job_id, error: 'Job already running' };
  }
  
  const ralphPath = getRalphPath();
  console.log(`[RalphRunner] Ralph path: ${ralphPath}`);
  
  // Build the Python command
  // We'll create a simple CLI wrapper that takes job JSON as argument
  const pythonScript = path.join(ralphPath, 'run_job.py');
  const jobJson = JSON.stringify(job);
  
  try {
    // Use full path to Python to avoid PATH issues in Electron
    const pythonCmd = PYTHON_PATH;
    
    // Spawn the Python process
    const proc = spawn(pythonCmd, [pythonScript, jobJson], {
      cwd: ralphPath,
      env: {
        ...process.env,
        PYTHONPATH: path.dirname(ralphPath),  // Add parent to path
        PYTHONUNBUFFERED: '1',  // Disable output buffering
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    // Track the process
    activeProcesses.set(job.job_id, {
      process: proc,
      jobId: job.job_id,
      status: 'running',
    });
    
    // Send started event
    sendEvent(mainWindow, {
      type: 'started',
      job_id: job.job_id,
      data: { title: job.title, objective: job.objective },
    });
    
    // Handle stdout (structured events as JSON lines)
    let buffer = '';
    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      
      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';  // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            // Try to parse as JSON event
            const event = JSON.parse(line);
            sendEvent(mainWindow, { ...event, job_id: job.job_id });
          } catch {
            // Plain text log
            sendEvent(mainWindow, {
              type: 'log',
              job_id: job.job_id,
              data: { message: line },
            });
          }
        }
      }
    });
    
    // Handle stderr (errors and warnings)
    proc.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        console.error(`[RalphRunner:${job.job_id}] stderr:`, message);
        sendEvent(mainWindow, {
          type: 'log',
          job_id: job.job_id,
          data: { message, level: 'error' },
        });
      }
    });
    
    // Handle process exit
    proc.on('close', (code) => {
      console.log(`[RalphRunner] Job ${job.job_id} exited with code ${code}`);
      
      const entry = activeProcesses.get(job.job_id);
      if (entry) {
        entry.status = 'stopped';
        activeProcesses.delete(job.job_id);
      }
      
      sendEvent(mainWindow, {
        type: 'completed',
        job_id: job.job_id,
        data: {
          exit_code: code,
          success: code === 0,
        },
      });
    });
    
    proc.on('error', (err) => {
      console.error(`[RalphRunner] Job ${job.job_id} error:`, err);
      
      activeProcesses.delete(job.job_id);
      
      sendEvent(mainWindow, {
        type: 'error',
        job_id: job.job_id,
        data: { message: err.message },
      });
    });
    
    return { success: true, job_id: job.job_id };
    
  } catch (error) {
    console.error(`[RalphRunner] Failed to start job ${job.job_id}:`, error);
    return {
      success: false,
      job_id: job.job_id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stop a running Ralph loop
 */
async function stopRalphLoop(jobId: string): Promise<{
  success: boolean;
  job_id: string;
  error?: string;
}> {
  console.log(`[RalphRunner] Stopping job: ${jobId}`);
  
  const entry = activeProcesses.get(jobId);
  if (!entry) {
    return { success: false, job_id: jobId, error: 'Job not found' };
  }
  
  if (entry.status !== 'running') {
    return { success: false, job_id: jobId, error: `Job is ${entry.status}` };
  }
  
  entry.status = 'stopping';
  
  // Try graceful shutdown first (SIGTERM)
  entry.process.kill('SIGTERM');
  
  // Force kill after 5 seconds if still running
  setTimeout(() => {
    if (entry.process.killed === false) {
      console.log(`[RalphRunner] Force killing job ${jobId}`);
      entry.process.kill('SIGKILL');
    }
  }, 5000);
  
  return { success: true, job_id: jobId };
}

/**
 * Get status of all active loops
 */
function getActiveLoopStatus(): Array<{
  job_id: string;
  status: string;
}> {
  return Array.from(activeProcesses.entries()).map(([jobId, entry]) => ({
    job_id: jobId,
    status: entry.status,
  }));
}

/**
 * Send event to renderer
 */
function sendEvent(mainWindow: BrowserWindow, event: RalphEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ralph:event', event);
  }
}

/**
 * Cleanup on app quit
 */
export function cleanupRalphProcesses(): void {
  console.log(`[RalphRunner] Cleaning up ${activeProcesses.size} processes`);
  
  for (const [jobId, entry] of activeProcesses) {
    console.log(`[RalphRunner] Killing job ${jobId}`);
    entry.process.kill('SIGKILL');
  }
  
  activeProcesses.clear();
}
