const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  callClaude: (payload) => ipcRenderer.invoke('ai-call', payload),
  fetchDishImage: (dish) => ipcRenderer.invoke('fetch-dish-image', dish)
});
