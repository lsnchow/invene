import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import Store from 'electron-store';

const store = new Store();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendProcess: ChildProcess | null = null;

const BACKEND_PORT = 8811;
const isDev = process.env.NODE_ENV !== 'production';

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load renderer
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  // Create a simple lightning bolt icon
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Lightning Loop', click: () => mainWindow?.show() },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setToolTip('Lightning Loop');
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

  // Paste to VS Code / Cursor
  ipcMain.handle('automation:paste-to-editor', async (_event, editorType: 'vscode' | 'cursor') => {
    return await pasteToEditor(editorType);
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

async function pasteToEditor(editorType: 'vscode' | 'cursor'): Promise<boolean> {
  const { exec } = await import('child_process');
  
  // macOS: Use AppleScript to focus and paste
  if (process.platform === 'darwin') {
    const appName = editorType === 'vscode' ? 'Visual Studio Code' : 'Cursor';
    const script = `
      tell application "${appName}"
        activate
      end tell
      delay 0.3
      tell application "System Events"
        keystroke "v" using command down
      end tell
    `;
    
    return new Promise((resolve) => {
      exec(`osascript -e '${script}'`, (error) => {
        resolve(!error);
      });
    });
  }
  
  // Windows: Use PowerShell
  if (process.platform === 'win32') {
    const processName = editorType === 'vscode' ? 'Code' : 'Cursor';
    const script = `
      Add-Type -AssemblyName Microsoft.VisualBasic
      $process = Get-Process -Name "${processName}" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($process) {
        [Microsoft.VisualBasic.Interaction]::AppActivate($process.Id)
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("^v")
      }
    `;
    
    return new Promise((resolve) => {
      exec(`powershell -Command "${script}"`, (error) => {
        resolve(!error);
      });
    });
  }

  return false;
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();
  registerGlobalShortcut();
  setupIpcHandlers();
  
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
