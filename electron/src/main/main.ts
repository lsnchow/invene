import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Tray, Menu, nativeImage, screen } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import Store from 'electron-store';
import { initRemoteJobListener } from './remoteJobListener';

const store = new Store();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendProcess: ChildProcess | null = null;

const BACKEND_PORT = 8811;
const isDev = process.env.NODE_ENV !== 'production';

function createWindow(): void {
  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  
  const windowWidth = 320;
  const windowHeight = 240;
  
  // Position: top center of screen
  const x = Math.round((screenWidth - windowWidth) / 2);
  const y = 40; // Just below menu bar

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    show: false, // Start hidden
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load renderer
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    console.log('[Invene] Window ready, showing UI');
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Re-center when shown
  mainWindow.on('show', () => {
    const display = screen.getPrimaryDisplay();
    const { width: sw } = display.workAreaSize;
    const bounds = mainWindow?.getBounds();
    if (bounds) {
      mainWindow?.setPosition(Math.round((sw - bounds.width) / 2), 40);
    }
  });
}

function createTray(): void {
  // Create a simple lightning bolt icon
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Invene', click: () => mainWindow?.show() },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setToolTip('Invene');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
}

function startBackend(): void {
  const backendPath = path.join(__dirname, '..', '..', 'backend');
  
  backendProcess = spawn('python', ['-m', 'uvicorn', 'lightning_loop.main:app', '--port', String(BACKEND_PORT)], {
    cwd: backendPath,
    env: { ...process.env },
    stdio: 'pipe',
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[Backend] ${data}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend] ${data}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

function stopBackend(): void {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function registerGlobalShortcut(): void {
  // Cmd+Shift+L on Mac, Ctrl+Shift+L on Windows/Linux
  const shortcut = process.platform === 'darwin' ? 'CommandOrControl+Shift+L' : 'Ctrl+Shift+L';
  
  globalShortcut.register(shortcut, () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Clipboard operations
  ipcMain.handle('clipboard:read', () => {
    return clipboard.readText();
  });

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text);
    return true;
  });

  // Write PRD to file and open in VS Code / Cursor
  ipcMain.handle('automation:open-prd-in-editor', async (_event, content: string, editorType: 'vscode' | 'cursor') => {
    return await openPrdInEditor(content, editorType);
  });

  // Backend API proxy
  ipcMain.handle('api:request', async (_event, endpoint: string, options: RequestInit) => {
    const url = `http://localhost:${BACKEND_PORT}${endpoint}`;
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, error: String(error) };
    }
  });

  // Window controls
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.hide();
  });

  // Store operations
  ipcMain.handle('store:get', (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    store.set(key, value);
    return true;
  });
}

async function openPrdInEditor(content: string, editorType: 'vscode' | 'cursor'): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const fs = await import('fs');
  const os = await import('os');
  const { exec } = await import('child_process');
  
  try {
    // Create PRD file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `PRD-${timestamp}.md`;
    const prdDir = path.join(os.homedir(), 'Documents', 'Invene', 'PRDs');
    
    // Ensure directory exists
    fs.mkdirSync(prdDir, { recursive: true });
    
    const filePath = path.join(prdDir, fileName);
    
    // Write the PRD content
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[Invene] PRD written to: ${filePath}`);
    
    // Open in editor using CLI
    const cliCommand = editorType === 'vscode' ? 'code' : 'cursor';
    
    return new Promise((resolve) => {
      exec(`${cliCommand} "${filePath}"`, (error) => {
        if (error) {
          console.error(`[Invene] Failed to open in ${editorType}:`, error);
          resolve({ success: false, filePath, error: error.message });
        } else {
          console.log(`[Invene] Opened PRD in ${editorType}`);
          resolve({ success: true, filePath });
        }
      });
    });
  } catch (error) {
    console.error('[Invene] Failed to write PRD:', error);
    return { success: false, error: String(error) };
  }
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();
  registerGlobalShortcut();
  setupIpcHandlers();
  
  // Initialize remote job listener for Web Orchestrator
  if (mainWindow) {
    initRemoteJobListener(mainWindow);
  }
  
  if (!isDev) {
    startBackend();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopBackend();
});
