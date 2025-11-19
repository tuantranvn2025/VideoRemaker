export type FlowOptions = {
  sessionKey: string;
  baseUrl?: string; // default to labs.withgoogle.com/flow
  headerName?: string; // e.g., 'Authorization'
  headerPrefix?: string; // e.g., 'Bearer '
  cookieName?: string; // e.g., 'session'
  timeoutMs?: number;
};

const defaultBase = 'https://labs.withgoogle.com/flow';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function tryFetchWithAuth(url: string, sessionKey: string, opts: FlowOptions, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as any || {}) };
  if (opts.headerName && opts.headerPrefix !== undefined) {
    headers[opts.headerName] = `${opts.headerPrefix || ''}${sessionKey}`;
  }
  if (opts.cookieName) {
    headers['Cookie'] = `${opts.cookieName}=${sessionKey}`;
  }
  init.headers = headers;
  return fetch(url, init);
}

export async function generateVideoFromFlow(prompt: string, options: FlowOptions): Promise<{ success: boolean; url?: string; message?: string }> {
  const base = options.baseUrl || defaultBase;
  const endpoints = ['/api/videos', '/api/video', '/api/generate', '/_/api/videos', '/_/api/generate'];
  const bodyShapes = [
    (p: string) => ({ prompt: p }),
    (p: string) => ({ input: p }),
    (p: string) => ({ text: p }),
    (p: string) => ({ request: { prompt: p } }),
  ];

  for (const ep of endpoints) {
    const url = `${base.replace(/\/$/, '')}${ep}`;
    for (const shape of bodyShapes) {
      try {
        const resp = await tryFetchWithAuth(url, options.sessionKey, options, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(shape(prompt))
        });
        if (!resp) continue;
        if (resp.status === 403 || resp.status === 401) {
          return { success: false, message: `Auth failed with status ${resp.status}` };
        }
        const text = await resp.text();
        let json: any = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        // If response contains direct video URL
        const possibleUrl = json?.download_url || json?.video_url || json?.url || json?.result?.url || json?.data?.url;
        const jobId = json?.id || json?.video_id || json?.jobId || json?.job_id || json?.result?.id;
        if (possibleUrl) {
          // fetch the video and return blob URL
          const vidResp = await tryFetchWithAuth(possibleUrl, options.sessionKey, options, {});
          if (!vidResp.ok) return { success: false, message: `Failed to fetch video: ${vidResp.status}` };
          const blob = await vidResp.blob();
          return { success: true, url: URL.createObjectURL(blob) };
        }
        if (jobId) {
          // Poll for job status
          const statusUrlCandidates = [
            `${base.replace(/\/$/, '')}/api/videos/${jobId}`,
            `${base.replace(/\/$/, '')}/api/video/${jobId}`,
            `${base.replace(/\/$/, '')}/_/api/videos/${jobId}`,
          ];
          const timeoutAt = Date.now() + (options.timeoutMs || 2 * 60 * 1000);
          while (Date.now() < timeoutAt) {
            for (const statusUrl of statusUrlCandidates) {
              try {
                const statusResp = await tryFetchWithAuth(statusUrl, options.sessionKey, options, { method: 'GET' });
                if (!statusResp.ok) continue;
                const stText = await statusResp.text();
                let stJson: any = null;
                try { stJson = JSON.parse(stText); } catch (e) { stJson = null; }
                const state = stJson?.status || stJson?.state || stJson?.phase;
                const readyUrl = stJson?.download_url || stJson?.video_url || stJson?.result?.url || stJson?.url || stJson?.data?.url;
                if (readyUrl) {
                  const vidResp = await tryFetchWithAuth(readyUrl, options.sessionKey, options, {});
                  if (!vidResp.ok) return { success: false, message: `Failed to fetch video: ${vidResp.status}` };
                  const blob = await vidResp.blob();
                  return { success: true, url: URL.createObjectURL(blob) };
                }
                if (state && (state === 'succeeded' || state === 'finished' || state === 'done' || state === 'completed')) {
                  // Maybe the status endpoint includes an asset object
                  const candidateUrl = stJson?.asset?.download_url || stJson?.result?.download_url || stJson?.artifact?.url;
                  if (candidateUrl) {
                    const vidResp = await tryFetchWithAuth(candidateUrl, options.sessionKey, options, {});
                    if (!vidResp.ok) return { success: false, message: `Failed to fetch video: ${vidResp.status}` };
                    const blob = await vidResp.blob();
                    return { success: true, url: URL.createObjectURL(blob) };
                  }
                }
              } catch (e) {
                // ignore per-endpoint errors
              }
            }
            await sleep(1500);
          }
          return { success: false, message: 'Timeout waiting for job completion' };
        }
        // If no jobId and no url, maybe API returned HTML or other info; continue trying
      } catch (e) {
        // ignore and try next shape/endpoint
      }
    }
  }
  return { success: false, message: 'No supported Flow endpoint responded' };
}
