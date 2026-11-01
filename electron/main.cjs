const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow;

if (!gotSingleInstanceLock) app.quit();

function openExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' || url.protocol === 'mailto:') {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed navigation requests.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#05050A',
    icon: `${__dirname}/assets/icon.ico`,
    title: 'Aetheris AI Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  void mainWindow.loadFile(path.join(__dirname, 'ide.html'));
}

ipcMain.handle('workspace:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('workspace:list', async (_event, root) => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((entry) => ({ name: entry.name, directory: entry.isDirectory(), path: path.join(root, entry.name) }));
});
ipcMain.handle('file:read', async (_event, filePath) => fs.readFile(filePath, 'utf8'));
ipcMain.handle('file:write', async (_event, filePath, content) => fs.writeFile(filePath, content, 'utf8'));
ipcMain.handle('terminal:run', async (_event, command, cwd) => {
  const child = spawn(process.platform === 'win32' ? 'powershell.exe' : 'sh', process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command], { cwd, windowsHide: true });
  child.stdout.on('data', (data) => mainWindow.webContents.send('terminal:output', data.toString()));
  child.stderr.on('data', (data) => mainWindow.webContents.send('terminal:output', data.toString()));
  child.on('close', (code) => mainWindow.webContents.send('terminal:output', `\n[process exited ${code}]\n`));
});
ipcMain.handle('shell:open', (_event, url) => openExternal(url));

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
  app.setName('Aetheris AI');
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
