const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aetheris', {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  listFiles: (root) => ipcRenderer.invoke('workspace:list', root),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content),
  runCommand: (command, cwd) => ipcRenderer.invoke('terminal:run', command, cwd),
  onTerminalOutput: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('terminal:output', listener);
    return () => ipcRenderer.removeListener('terminal:output', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open', url)
});
