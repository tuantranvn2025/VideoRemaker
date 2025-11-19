import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const isDev = process.env.NODE_ENV !== 'production';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(process.cwd(), 'dist', 'index.html'));
  }
}

app.on('ready', createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('show-save-dialog', async (_, options) => {
  return await dialog.showSaveDialog(options);
});

ipcMain.handle('merge-videos', async (event, { inputs, output }) => {
  try {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { success: false, message: 'No input files provided' };
    }

    const listFile = path.join(os.tmpdir(), `ffmpeg-list-${Date.now()}.txt`);
    // write lines like: file '/absolute/path'
    const content = inputs.map(p => `file '${p.replace(/'/g, "'\\'\'\'")}'`).join('\n');
    fs.writeFileSync(listFile, content, 'utf8');

    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output];
    const ff = spawn(ffmpegPath || 'ffmpeg', args);

    let stderr = '';
    ff.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      event.sender.send('merge-log', text);
    });

    return await new Promise((resolve) => {
      ff.on('error', (err) => {
        try { fs.unlinkSync(listFile); } catch {}
        resolve({ success: false, message: err.message });
      });
      ff.on('close', (code) => {
        try { fs.unlinkSync(listFile); } catch {}
        if (code === 0) resolve({ success: true, output });
        else resolve({ success: false, code, message: stderr });
      });
    });
  } catch (err) {
    return { success: false, message: String(err) };
  }
});

ipcMain.handle('merge-buffers', async (event, { files, output }) => {
  // files: [{ name: string, data: base64String }, ...]
  try {
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, message: 'No files provided' };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-merge-'));
    const paths = [];
    try {
      for (const f of files) {
        const filePath = path.join(tmpDir, f.name || `clip-${Date.now()}.mp4`);
        const buffer = Buffer.from(f.data, 'base64');
        fs.writeFileSync(filePath, buffer);
        paths.push(filePath);
      }

      const listFile = path.join(tmpDir, `ffmpeg-list-${Date.now()}.txt`);
      const content = paths.map(p => `file '${p.replace(/'/g, "'\\'\'\'\'")}'`).join('\n');
      fs.writeFileSync(listFile, content, 'utf8');

      const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output];
      const ff = spawn(ffmpegPath || 'ffmpeg', args);

      let stderr = '';
      ff.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        event.sender.send('merge-log', text);
      });

      return await new Promise((resolve) => {
        ff.on('error', (err) => {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          resolve({ success: false, message: err.message });
        });
        ff.on('close', (code) => {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          if (code === 0) resolve({ success: true, output });
          else resolve({ success: false, code, message: stderr });
        });
      });
    } catch (err) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return { success: false, message: String(err) };
    }
  } catch (err) {
    return { success: false, message: String(err) };
  }
});

ipcMain.handle('save-base64-file', async (event, { base64Data, filePath }) => {
  try {
    if (!base64Data || !filePath) return { success: false, message: 'Missing data or filePath' };
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, message: String(err) };
  }
});

// Open a BrowserWindow for user auth on Flow (VEO) and attempt to extract a session key
ipcMain.handle('open-flow-auth', async (_, { authUrl, keyNames = [], timeoutMs = 120000 }) => {
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 1000,
      height: 800,
      modal: true,
      show: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    });

    let finished = false;

    const cleanup = (result) => {
      if (finished) return;
      finished = true;
      try { authWin.close(); } catch (e) {}
      resolve(result);
    };

    // Try extracting common storage keys from the page
    const tryExtract = async () => {
      try {
        const script = `(function(){
          try {
            const keys = ${JSON.stringify(keyNames || [])};
            for(const k of keys){ try { if(window.localStorage && window.localStorage.getItem(k)) return {source:'localStorage', key:k, value: window.localStorage.getItem(k)}; } catch(e){}
              try { if(window.sessionStorage && window.sessionStorage.getItem(k)) return {source:'sessionStorage', key:k, value: window.sessionStorage.getItem(k)}; } catch(e){}
              try { const ck = document.cookie.split(';').map(c=>c.trim()); for(const c of ck){ const [n,v]=c.split('='); if(n===k) return {source:'cookie', key:k, value: decodeURIComponent(v)} } } catch(e){}
            }
            // generic heuristics
            try { if(window.__SESSION__) return {source:'global', key:'__SESSION__', value: window.__SESSION__}; } catch(e){}
            try { if(window.__APP__ && window.__APP__.session) return {source:'global', key:'__APP__.session', value: window.__APP__.session}; } catch(e){}
            return null;
          } catch(e){ return null; }
        })()`;
        const res = await authWin.webContents.executeJavaScript(script, true);
        return res;
      } catch (err) {
        return null;
      }
    };

    authWin.webContents.on('did-finish-load', async () => {
      // Poll a few times after load to allow SPA frameworks to initialize
      for (let i = 0; i < 6; i++) {
        const found = await tryExtract();
        if (found && found.value) {
          appLogger && appLogger.add && appLogger.add('INFO', 'open-flow-auth detected session', { found: found.key });
          cleanup({ success: true, session: found.value, source: found.source, key: found.key });
          return;
        }
        await new Promise(r => setTimeout(r, 800));
      }
    });

    // also poll periodically in case SPA changes after navigation
    const pollInterval = setInterval(async () => {
      const found = await tryExtract();
      if (found && found.value) {
        clearInterval(pollInterval);
        cleanup({ success: true, session: found.value, source: found.source, key: found.key });
      }
    }, 1000);

    // handle user close
    authWin.on('closed', () => {
      clearInterval(pollInterval);
      cleanup({ success: false, message: 'Window closed by user' });
    });

    // timeout
    const to = setTimeout(() => {
      clearInterval(pollInterval);
      cleanup({ success: false, message: 'Timeout waiting for session' });
    }, timeoutMs || 120000);

    authWin.loadURL(authUrl);
  });
});
