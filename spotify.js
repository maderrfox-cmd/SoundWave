// Spotify import (main process): login with PKCE, token refresh, reading playlists and liked songs.
// Only reads: SoundWave never changes anything on the Spotify account.
const { app, BrowserWindow, net, safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { mapSpotifyTrack } = require('./player-lib');

const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';
const file = () => path.join(app.getPath('userData'), 'spotify.json');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Saved state: { clientId, name, userId, refresh (encrypted when the OS allows it) }. Access token stays in memory.
let state = {};
let access = { token: '', until: 0 };
try { state = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch {}
const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
const getRefresh = () => {
  if (!state.refresh) return '';
  try { return state.enc ? safeStorage.decryptString(Buffer.from(state.refresh, 'base64')) : state.refresh; } catch { return ''; }
};
function save(refresh) {
  if (refresh !== undefined) {
    const enc = canEncrypt();
    state.refresh = enc ? safeStorage.encryptString(refresh).toString('base64') : refresh;
    state.enc = enc;
  }
  fs.writeFileSync(file(), JSON.stringify(state, null, 2));
}

async function tokenRequest(params) {
  const r = await net.fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: state.clientId, ...params }).toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || `Spotify a refusé (${r.status})`);
  access = { token: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
  if (data.refresh_token) save(data.refresh_token);
  return access.token;
}

async function token() {
  if (access.token && Date.now() < access.until) return access.token;
  const refresh = getRefresh();
  if (!refresh) throw new Error('Pas connecté à Spotify');
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
}

// GET on the Web API with one retry on expired token or rate limit.
async function get(url, retried = false) {
  const r = await net.fetch(url.startsWith('http') ? url : 'https://api.spotify.com/v1' + url, {
    headers: { Authorization: 'Bearer ' + await token() },
  });
  if (r.status === 401 && !retried) { access.until = 0; return get(url, true); }
  if (r.status === 429 && !retried) {
    await new Promise((res) => setTimeout(res, Math.min(10, +r.headers.get('retry-after') || 2) * 1000));
    return get(url, true);
  }
  if (r.status === 403) throw new Error('Spotify refuse l\'accès (403). Vérifie que ton compte est bien ajouté dans « User Management » de ton appli Spotify, et que le propriétaire de l\'appli a Premium.');
  if (!r.ok) throw new Error(`Erreur Spotify (${r.status})`);
  return r.json();
}

async function all(url, max = 2000) {
  const out = [];
  for (let next = url; next && out.length < max;) {
    const page = await get(next);
    out.push(...(page.items || []));
    next = page.next;
  }
  return out;
}

// Opens the Spotify login page in a small window and waits for it to come back to our local address.
function login(clientId, redirectUri, parent) {
  state = { clientId };
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const nonce = b64url(crypto.randomBytes(12));
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
    code_challenge_method: 'S256', code_challenge: challenge, state: nonce, scope: SCOPES,
  });
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ width: 520, height: 760, parent, modal: true, title: 'Connexion Spotify', autoHideMenuBar: true,
      webPreferences: { partition: 'persist:spotify-login' } });
    let done = false;
    const finish = async (target) => {
      if (done || !target.startsWith(redirectUri)) return;
      done = true;
      const q = new URL(target).searchParams;
      setTimeout(() => !w.isDestroyed() && w.close(), 900);
      if (q.get('error')) return reject(new Error(q.get('error') === 'access_denied' ? 'Connexion annulée.' : q.get('error')));
      if (q.get('state') !== nonce) return reject(new Error('Réponse Spotify invalide, réessaie.'));
      try {
        await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri, code_verifier: verifier });
        const me = await get('/me');
        state.name = me.display_name || me.id; state.userId = me.id; save();
        resolve(status());
      } catch (e) { reject(e); }
    };
    w.webContents.on('will-redirect', (_e, u) => finish(u));
    w.webContents.on('will-navigate', (_e, u) => finish(u));
    w.webContents.on('did-navigate', (_e, u) => finish(u));
    w.on('closed', () => { if (!done) reject(new Error('Connexion annulée.')); });
    w.loadURL(url);
  });
}

const status = () => ({ connected: !!getRefresh(), name: state.name || '', clientId: state.clientId || '' });

function logout() {
  access = { token: '', until: 0 };
  state = { clientId: state.clientId };
  save();
  return status();
}

async function playlists() {
  const items = await all('/me/playlists?limit=50', 500);
  return items.filter(Boolean).map((p) => ({
    id: p.id, name: p.name,
    count: p.items?.total ?? p.tracks?.total ?? 0,
    image: p.images?.[p.images.length > 1 ? 1 : 0]?.url || '',
    // Spotify only lets apps read playlists you own or collaborate on.
    readable: p.owner?.id === state.userId || !!p.collaborative,
  }));
}

async function tracks(id) {
  const items = id === 'liked'
    ? await all('/me/tracks?limit=50')
    : await all(`/playlists/${encodeURIComponent(id)}/items?limit=50`);
  return items.map(mapSpotifyTrack).filter(Boolean);
}

module.exports = { login, logout, status, playlists, tracks };
