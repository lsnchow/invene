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
    pasteToEditor: (editor: 'vscode' | 'cursor'): Promise<boolean> => 
      ipcRenderer.invoke('automation:paste-to-editor', editor),
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
});

// Type definitions for renderer
export interface ElectronAPI {
  clipboard: {
    read: () => Promise<string>;
    write: (text: string) => Promise<boolean>;
  };
  automation: {
    pasteToEditor: (editor: 'vscode' | 'cursor') => Promise<boolean>;
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
