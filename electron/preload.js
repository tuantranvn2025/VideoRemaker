import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  mergeVideos: (inputs, output) => ipcRenderer.invoke('merge-videos', { inputs, output }),
  mergeBuffers: (files, output) => ipcRenderer.invoke('merge-buffers', { files, output }),
  saveBase64File: (base64Data, filePath) => ipcRenderer.invoke('save-base64-file', { base64Data, filePath }),
  onMergeLog: (callback) => {
    const listener = (_, chunk) => callback(chunk);
    ipcRenderer.on('merge-log', listener);
    return () => ipcRenderer.removeListener('merge-log', listener);
  },
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options)
  ,
  openFlowAuth: (options) => ipcRenderer.invoke('open-flow-auth', options)
});
