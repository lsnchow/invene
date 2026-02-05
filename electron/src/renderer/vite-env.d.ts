/// <reference types="vite/client" />

declare module '*.webp' {
  const src: string;
  export default src;
}

interface RalphJobSpec {
  job_id: string;
  title: string;
  objective: string;
  scope_included?: string[];
  scope_excluded?: string[];
  constraints?: string[];
  success_criteria?: string[];
  verification_commands?: string[];
  estimated_iterations?: number;
}

interface RalphEvent {
  type: 'started' | 'iteration' | 'action' | 'decision' | 'completed' | 'error' | 'log' | 'result';
  job_id: string;
  data: Record<string, unknown>;
}

interface Window {
  electronAPI: {
    openExternal: (url: string) => Promise<void>;
    clipboard: {
      read: () => Promise<string>;
      write: (text: string) => Promise<boolean>;
    };
    automation: {
      pasteToEditor: (editor: 'vscode' | 'cursor') => Promise<boolean>;
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
      getStatus: () => Promise<{ enabled: boolean; isPolling: boolean; currentJob: unknown | null }>;
      setEnabled: (enabled: boolean) => Promise<{ enabled: boolean }>;
      setRelayUrl: (url: string) => Promise<{ relayUrl: string }>;
      onJobClaimed: (callback: (job: unknown) => void) => void;
      onNodeStart: (callback: (data: unknown) => void) => void;
      onNodeComplete: (callback: (data: unknown) => void) => void;
      onJobCompleted: (callback: (data: unknown) => void) => void;
      onJobFailed: (callback: (data: unknown) => void) => void;
    };
    ralph: {
      start: (job: RalphJobSpec) => Promise<{ success: boolean; job_id: string; error?: string }>;
      stop: (jobId: string) => Promise<{ success: boolean; job_id: string; error?: string }>;
      getStatus: () => Promise<Array<{ job_id: string; status: string }>>;
      onEvent: (callback: (event: RalphEvent) => void) => void;
      removeEventListener: () => void;
    };
  };
}
