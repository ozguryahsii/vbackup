import { toast } from './ui.js';

export const state = {
  meta: null,
  system: (() => { try { return localStorage.getItem('vb.system') || ''; } catch { return ''; } })(),
};

export function withSystem(path, extra = {}) {
  const p = new URLSearchParams(extra);
  if (state.system && !p.has('system')) p.set('system', state.system);
  for (const [k, v] of [...p]) if (v === '' || v === undefined || v === null) p.delete(k);
  const q = p.toString();
  return q ? `${path}${path.includes('?') ? '&' : '?'}${q}` : path;
}

async function request(method, path, body, { raw = false, quiet = false } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (raw) { opts.body = body; opts.headers['Content-Type'] = 'application/octet-stream'; }
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(path, opts);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const msg = data?.error || `İstek başarısız (${res.status})`;
    if (!quiet) toast(msg, 'err');
    throw new Error(msg);
  }
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b, o),
  put: (p, b, o) => request('PUT', p, b, o),
  del: (p, o) => request('DELETE', p, undefined, o),
  upload: (p, file) => request('POST', p, file, { raw: true }),
};

export async function loadMeta() {
  state.meta = await api.get('/api/meta');
  return state.meta;
}
