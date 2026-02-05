import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Clipboard
  clipboard: {
    read: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
    write: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write', text),
  },

  // Automation
  automation: {
    openPrdInEditor: (content: string, editor: 'vscode' | 'cursor'): Promise<{ success: boolean; filePath?: string; error?: string }> => 
      ipcRenderer.invoke('automation:open-prd-in-editor', content, editor),
  },

  // API proxy to backend
  api: {
    request: async <T>(endpoint: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data?: T; error?: string }> =>
      ipcRenderer.invoke('api:request', endpoint, options || {}),
  },

  // Window controls
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  },

  // Persistent store
  store: {
    get: <T>(key: string): Promise<T | undefined> => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown): Promise<boolean> => ipcRenderer.invoke('store:set', key, value),
  },
  
  // Remote job listener for Web Orchestrator
  remoteJob: {
    getStatus: (): Promise<{ enabled: boolean; isPolling: boolean; currentJob: any | null }> =>
      ipcRenderer.invoke('remote-job:get-status'),
    setEnabled: (enabled: boolean): Promise<{ enabled: boolean }> =>
      ipcRenderer.invoke('remote-job:set-enabled', enabled),
    setRelayUrl: (url: string): Promise<{ relayUrl: string }> =>
      ipcRenderer.invoke('remote-job:set-relay-url', url),
    onJobClaimed: (callback: (job: any) => void) => {
      ipcRenderer.on('remote-job:claimed', (_event, job) => callback(job));
    },
    onNodeStart: (callback: (data: any) => void) => {
      ipcRenderer.on('remote-job:node-start', (_event, data) => callback(data));
    },
    onNodeComplete: (callback: (data: any) => void) => {
      ipcRenderer.on('remote-job:node-complete', (_event, data) => callback(data));
    },
    onJobCompleted: (callback: (data: any) => void) => {
      ipcRenderer.on('remote-job:completed', (_event, data) => callback(data));
    },
    onJobFailed: (callback: (data: any) => void) => {
      ipcRenderer.on('remote-job:failed', (_event, data) => callback(data));
    },
  },
});

// Type definitions for renderer
export interface ElectronAPI {
  clipboard: {
    read: () => Promise<string>;
    write: (text: string) => Promise<boolean>;
  };
  automation: {
    openPrdInEditor: (content: string, editor: 'vscode' | 'cursor') => Promise<{ success: boolean; filePath?: string; error?: string }>;
  };
  api: {
    request: <T>(endpoint: string, options?: RequestInit) => Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
  };
  window: {
    minimize: () => Promise<void>;
    close: () => Promise<void>;
  };
  store: {
    get: <T>(key: string) => Promise<T | undefined>;
    set: (key: string, value: unknown) => Promise<boolean>;
  };
  remoteJob: {
    getStatus: () => Promise<{ enabled: boolean; isPolling: boolean; currentJob: any | null }>;
    setEnabled: (enabled: boolean) => Promise<{ enabled: boolean }>;
    setRelayUrl: (url: string) => Promise<{ relayUrl: string }>;
    onJobClaimed: (callback: (job: any) => void) => void;
    onNodeStart: (callback: (data: any) => void) => void;
    onNodeComplete: (callback: (data: any) => void) => void;
    onJobCompleted: (callback: (data: any) => void) => void;
    onJobFailed: (callback: (data: any) => void) => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
