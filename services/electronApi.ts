/* Renderer-side wrapper for Electron IPC exposed by preload.js */
declare global {
  interface Window {
    electronAPI?: {
      mergeVideos: (inputs: string[], output: string) => Promise<any>;
      mergeBuffers?: (files: { name?: string; data: string }[], output: string) => Promise<any>;
      onMergeLog: (cb: (chunk: string) => void) => () => void;
      showSaveDialog: (options: any) => Promise<any>;
      saveBase64File?: (base64Data: string, filePath: string) => Promise<any>;
      openFlowAuth?: (options: { authUrl: string; keyNames?: string[]; timeoutMs?: number }) => Promise<any>;
    };
  }
}

export async function mergeVideos(inputs: string[], output: string) {
  return window.electronAPI?.mergeVideos(inputs, output);
}

export async function mergeBuffers(files: { name?: string; data: string }[], output: string) {
  return window.electronAPI?.mergeBuffers?.(files, output);
}

export async function saveBase64File(base64Data: string, filePath: string) {
  return window.electronAPI?.saveBase64File?.(base64Data, filePath);
}

export function onMergeLog(cb: (chunk: string) => void) {
  return window.electronAPI?.onMergeLog(cb);
}

export async function showSaveDialog(options: any) {
  return window.electronAPI?.showSaveDialog(options);
}

export async function openFlowAuth(options: { authUrl: string; keyNames?: string[]; timeoutMs?: number }) {
  return window.electronAPI?.openFlowAuth?.(options);
}
