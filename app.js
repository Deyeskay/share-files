'use strict';

const cfg = window.SHARE_FILES_CONFIG || {};
const API = 'https://api.github.com';
const TOKEN_KEY = 'sharefiles.token';
const STATE_KEY = 'sharefiles.oauthstate';

// GitHub refuses files over 100 MB through the Contents API, and anything over
// ~25 MB is already slow because the request body is base64 (+33% size).
const WARN_BYTES = 25 * 1024 * 1024;
const MAX_BYTES = 100 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const el = {
  setup: $('view-setup'), setupMsg: $('setup-msg'),
  login: $('view-login'), loginRepo: $('login-repo'), signin: $('signin'),
  files: $('view-files'), who: $('who'), avatar: $('avatar'),
  loginName: $('login'), signout: $('signout'),
  drop: $('drop'), picker: $('picker'), browse: $('browse'),
  targetPath: $('target-path'), queue: $('queue'),
  crumbs: $('crumbs'), refresh: $('refresh'),
  list: $('list'), empty: $('empty'), loading: $('loading'),
  toasts: $('toasts'),
};

let token = null;
let cwd = '';          // path relative to cfg.basePath; '' means its root
let busy = false;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toast(msg, isErr) {
  const node = document.createElement('div');
  node.className = 'toast' + (isErr ? ' err' : '');
  node.textContent = msg;
  el.toasts.append(node);
  setTimeout(() => node.remove(), isErr ? 7000 : 3500);
}

function fmtSize(n) {
  if (n == null) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}

/** Join path pieces, dropping empties, with no leading or trailing slash. */
function joinPath(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, '');
}

/** Full repo path for the current folder (basePath + cwd + name). */
function repoPath(name) {
  return joinPath(cfg.basePath || '', cwd, name || '');
}

/** Percent-encode a path while keeping slashes as separators. */
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function setView(which) {
  el.setup.hidden = which !== 'setup';
  el.login.hidden = which !== 'login';
  el.files.hidden = which !== 'files';
  el.who.hidden = which !== 'files';
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });

  if (res.status === 401) {
    signOut();
    throw new Error('Your session expired. Please sign in again.');
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body && body.message) detail = body.message;
    } catch { /* error body was not JSON */ }

    if (res.status === 404) {
      detail = 'Not found. Check that "' + cfg.dataRepo + '" exists and that you ' +
               'granted access to it when signing in.';
    } else if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      detail = 'GitHub rate limit reached. Try again in a few minutes.';
    } else if (res.status === 409) {
      detail = 'The repo changed while writing. Hit Refresh and try again.';
    }
    throw new Error(detail);
  }
  return res;
}

const contentsUrl = (p) => '/repos/' + cfg.dataRepo + '/contents/' + encodePath(p);

async function listFolder(path) {
  let res;
  try {
    res = await gh(contentsUrl(path) + '?ref=' + encodeURIComponent(cfg.branch));
  } catch (e) {
    // A folder that does not exist yet is a normal empty state, not an error.
    if (/Not found/.test(e.message)) return [];
    throw e;
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];   // path pointed at a file, not a folder
  return data
    .filter((x) => x.type === 'dir' || x.type === 'file')
    .sort((a, b) => (a.type !== b.type
      ? (a.type === 'dir' ? -1 : 1)
      : a.name.localeCompare(b.name, undefined, { numeric: true })));
}

/** ArrayBuffer to base64, chunked so large files do not blow the call stack. */
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/** The existing file sha at path, or null when absent. Required to overwrite. */
async function shaAt(path) {
  try {
    const res = await gh(contentsUrl(path) + '?ref=' + encodeURIComponent(cfg.branch));
    const data = await res.json();
    return Array.isArray(data) ? null : data.sha;
  } catch {
    return null;
  }
}

async function uploadFile(file, onStatus) {
  if (file.size > MAX_BYTES) {
    throw new Error('Too large for the GitHub API (100 MB limit).');
  }
  onStatus('reading');
  const content = toBase64(await file.arrayBuffer());
  const path = repoPath(file.name);

  onStatus('checking');
  const sha = await shaAt(path);

  onStatus(sha ? 'replacing' : 'uploading');
  await gh(contentsUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: (sha ? 'Replace ' : 'Add ') + path + ' via share-files',
      content: content,
      branch: cfg.branch,
      ...(sha ? { sha: sha } : {}),
    }),
  });
  return !!sha;
}

async function downloadFile(entry) {
  // The blobs API works for private repos and for files over 1 MB, which the
  // contents API will not return inline.
  const res = await gh('/repos/' + cfg.dataRepo + '/git/blobs/' + entry.sha, {
    headers: { Accept: 'application/vnd.github.raw' },
  });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = entry.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function deleteFile(entry) {
  await gh(contentsUrl(entry.path), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Delete ' + entry.path + ' via share-files',
      sha: entry.sha,
      branch: cfg.branch,
    }),
  });
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

const ICON_DIR = '<svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3h-6.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5.25 1Z"/></svg>';
const ICON_FILE = '<svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Zm7.5-.188V4.25c0 .138.112.25.25.25h2.688a.25.25 0 0 0 .177-.427L9.927 1.385a.25.25 0 0 0-.427.177Z"/></svg>';

function renderCrumbs() {
  el.crumbs.textContent = '';
  const parts = cwd ? cwd.split('/') : [];

  const add = (label, path, isLast) => {
    if (isLast) {
      const span = document.createElement('span');
      span.className = 'cur';
      span.textContent = label;
      el.crumbs.append(span);
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => navigate(path));
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '/';
    el.crumbs.append(b, sep);
  };

  add(cfg.basePath || cfg.dataRepo.split('/')[1], '', parts.length === 0);
  parts.forEach((p, i) => add(p, parts.slice(0, i + 1).join('/'), i === parts.length - 1));
}

function renderList(entries) {
  el.list.textContent = '';
  el.empty.hidden = entries.length > 0;

  for (const entry of entries) {
    const li = document.createElement('li');
    li.insertAdjacentHTML('afterbegin', entry.type === 'dir' ? ICON_DIR : ICON_FILE);

    const meta = document.createElement('div');
    meta.className = 'meta';

    if (entry.type === 'dir') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'name dir';
      btn.textContent = entry.name;
      btn.addEventListener('click', () => navigate(joinPath(cwd, entry.name)));
      meta.append(btn);
    } else {
      const span = document.createElement('span');
      span.className = 'name';
      span.textContent = entry.name;
      span.title = entry.name;
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = fmtSize(entry.size);
      meta.append(span, sub);
    }
    li.append(meta);

    const acts = document.createElement('div');
    acts.className = 'acts';

    if (entry.type === 'file') {
      const dl = document.createElement('button');
      dl.className = 'btn btn-sm';
      dl.textContent = 'Download';
      dl.addEventListener('click', () => guard(dl, 'Download', () => downloadFile(entry)));

      const rm = document.createElement('button');
      rm.className = 'btn btn-sm btn-ghost btn-danger';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        const warn = 'Remove "' + entry.name + '" from ' + cfg.dataRepo + '?\n\n' +
                     'It stays recoverable from the repo git history.';
        if (!confirm(warn)) return;
        guard(rm, 'Remove', async () => {
          await deleteFile(entry);
          toast('Removed ' + entry.name);
          await refresh();
        });
      });
      acts.append(dl, rm);
    }
    li.append(acts);
    el.list.append(li);
  }
}

/** Run an action with its button disabled, surfacing any failure as a toast. */
async function guard(btn, label, fn) {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = label + '…';
  try {
    await fn();
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

async function navigate(path) {
  cwd = path;
  await refresh();
}

async function refresh() {
  renderCrumbs();
  el.targetPath.textContent = cfg.dataRepo + '/' + (repoPath() || '(repo root)');
  el.loading.hidden = false;
  el.empty.hidden = true;
  try {
    renderList(await listFolder(repoPath()));
  } catch (e) {
    el.list.textContent = '';
    toast(e.message, true);
  } finally {
    el.loading.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// uploads
// ---------------------------------------------------------------------------

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  el.queue.hidden = false;
  el.queue.textContent = '';

  const rows = files.map((f) => {
    const row = document.createElement('div');
    row.className = 'qrow';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = f.name + ' (' + fmtSize(f.size) + ')';
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = 'queued';
    row.append(nm, st);
    el.queue.append(row);
    return { row: row, st: st };
  });

  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const row = rows[i].row;
    const st = rows[i].st;
    const file = files[i];
    if (file.size > WARN_BYTES && file.size <= MAX_BYTES) {
      st.textContent = 'large file, this may take a while…';
    }
    try {
      const replaced = await uploadFile(file, (s) => { st.textContent = s + '…'; });
      st.textContent = replaced ? 'replaced' : 'done';
      ok++;
    } catch (e) {
      row.classList.add('err');
      st.textContent = e.message;
    }
  }

  if (ok) toast('Uploaded ' + ok + ' of ' + files.length + ' file(s)');
  await refresh();
  setTimeout(() => { el.queue.hidden = true; el.queue.textContent = ''; }, 6000);
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

function redirectUri() {
  return location.origin + location.pathname;
}

function randomState() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function signIn() {
  const state = randomState();
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    toast('Browser storage is blocked, so sign-in cannot complete safely.', true);
    return;
  }
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('scope', 'repo');
  u.searchParams.set('state', state);
  location.assign(u.toString());
}

function signOut() {
  token = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  setView('login');
}

/**
 * If GitHub sent us back with ?code=..., trade it for a token via the Worker.
 * Returns true when this page load was an OAuth callback.
 */
async function completeOAuth() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const oauthError = params.get('error');

  if (!code && !oauthError) return false;

  // Clear the URL at once so the code is never reused, bookmarked or shared.
  history.replaceState({}, '', location.pathname);

  if (oauthError) {
    toast('GitHub refused the sign-in: ' +
          (params.get('error_description') || oauthError), true);
    return true;
  }

  let expected = null;
  try {
    expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch { /* ignore */ }

  // Without this check, someone could hand you a link that logs you into
  // their account instead of yours (login CSRF).
  if (!expected || expected !== returnedState) {
    toast('Sign-in state did not match, so it was aborted. Please try again.', true);
    return true;
  }

  const res = await fetch(cfg.tokenProxy, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code, redirect_uri: redirectUri() }),
  });

  let body = {};
  try { body = await res.json(); } catch { /* ignore */ }

  if (!res.ok || body.error || !body.access_token) {
    toast('Token exchange failed: ' +
          (body.error_description || body.error || 'HTTP ' + res.status), true);
    return true;
  }

  token = body.access_token;
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  return true;
}

async function loadUser() {
  const u = await (await gh('/user')).json();
  el.avatar.src = u.avatar_url;
  el.loginName.textContent = u.login;
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

function configProblem() {
  if (!cfg.clientId || cfg.clientId.indexOf('PASTE') === 0) {
    return 'config.js still holds the placeholder clientId. Register a GitHub ' +
           'OAuth App (README step 1) and paste its Client ID there.';
  }
  if (!cfg.tokenProxy || cfg.tokenProxy.includes('PASTE')) {
    return 'config.js still holds the placeholder tokenProxy. Deploy the Cloudflare ' +
           'Worker in worker/ (README step 2) and paste its URL there.';
  }
  if (!cfg.dataRepo || !cfg.dataRepo.includes('/')) {
    return 'config.js needs dataRepo set to "owner/repo".';
  }
  return null;
}

function wire() {
  el.signin.addEventListener('click', signIn);
  el.signout.addEventListener('click', signOut);
  el.refresh.addEventListener('click', () => guard(el.refresh, 'Refresh', refresh));
  el.browse.addEventListener('click', () => el.picker.click());
  el.picker.addEventListener('change', () => {
    handleFiles(el.picker.files);
    el.picker.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    el.drop.addEventListener(evt, (e) => {
      e.preventDefault();
      el.drop.classList.add('over');
    });
  });
  el.drop.addEventListener('dragleave', (e) => {
    if (!el.drop.contains(e.relatedTarget)) el.drop.classList.remove('over');
  });
  el.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    el.drop.classList.remove('over');
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
}

async function main() {
  const problem = configProblem();
  if (problem) {
    el.setupMsg.textContent = problem;
    setView('setup');
    return;
  }

  el.loginRepo.textContent = cfg.dataRepo;
  wire();

  try {
    await completeOAuth();
  } catch (e) {
    toast('Sign-in failed: ' + e.message, true);
  }

  if (!token) {
    try { token = localStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
  }
  if (!token) {
    setView('login');
    return;
  }

  try {
    await loadUser();
  } catch (e) {
    toast(e.message, true);
    signOut();
    return;
  }

  setView('files');
  await refresh();
}

main();
