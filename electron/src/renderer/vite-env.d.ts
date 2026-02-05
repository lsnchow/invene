/// <reference types="vite/client" />

declare module '*.webp' {
  const src: string;
  export default src;
}

interface Window {
  electronAPI: {
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
  };
}
