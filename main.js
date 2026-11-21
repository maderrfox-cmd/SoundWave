const { app, BrowserWindow, ipcMain, shell, net, Menu, Tray, clipboard, nativeImage, globalShortcut, session } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
// The app was called "Lueur" before: keep its data folder so playlists, YouTube key, settings and Spotify login stay.
// Must run before anything reads userData (spotify.js does on load).
app.setPath('userData', path.join(app.getPath('appData'), 'Lueur'));
const { palette, rankLyrics } = require('./player-lib');
const spotify = require('./spotify');
const discord = require('./discord');

// The YouTube player refuses to play from file:// (no referrer), so the UI is served over local http.
const FILES = { '/': 'player.html', '/player-lib.js': 'player-lib.js', '/assets/logo-small.png': 'assets/logo-small.png' };
// Fixed port keeps the same origin, so the saved key, playlists and settings (localStorage) survive restarts.
const PORT = 38491;

// Play without waiting for a click inside the YouTube frame.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// YouTube refuses many videos to players that identify as Electron: present as plain Chrome.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|lueur)\/\S+/gi, '');

let win = null, serverPort = PORT;
// Must match the Redirect URI saved in the Spotify app (Spotify refuses "localhost", only 127.0.0.1).
const spotifyRedirect = () => `http://127.0.0.1:${serverPort}/spotify`;
const send = (ch, v) => win && !win.isDestroyed() && win.webContents.send(ch, v);

function serve(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://x').pathname;
      if (pathname === '/spotify') { // Spotify login comes back here; the login window reads the code and closes
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<body style="font:16px system-ui;background:#111;color:#fff;display:grid;place-items:center;height:90vh">Connexion à Spotify… tu peux fermer cette fenêtre.</body>');
      }
      const file = FILES[pathname];
      if (!file) { res.writeHead(404); return res.end(); }
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      fs.createReadStream(path.join(__dirname, file)).pipe(res);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port)); // local only: no firewall prompt
  });
}

// Lyrics are fetched here, not in the page, so no CORS surprises.
// Returns several synced versions, the one closest in length to the playing clip first.
ipcMain.handle('lyrics', async (_e, artist, title, duration) => {
  const get = async (q) => {
    try {
      const r = await net.fetch('https://lrclib.net/api/search?' + new URLSearchParams(q), { headers: { 'User-Agent': 'SoundWave/3.0' } });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  };
  const [exact, loose] = await Promise.all([get({ track_name: title, artist_name: artist }), get({ q: `${artist} ${title}` })]);
  return rankLyrics([...exact, ...loose], duration);
});

// Cover colors for the "Dynamique" theme. Decoded here: the page can't read pixels of a cross-origin image.
ipcMain.handle('palette', async (_e, url) => {
  try {
    if (!/^https:\/\/(i\.ytimg\.com|i\.scdn\.co)\//.test(url)) return [];
    const img = nativeImage.createFromBuffer(Buffer.from(await (await net.fetch(url)).arrayBuffer()));
    const bmp = img.resize({ width: 32, height: 24 }).toBitmap(); // BGRA
    for (let i = 0; i < bmp.length; i += 4) [bmp[i], bmp[i + 2]] = [bmp[i + 2], bmp[i]];
    return palette(bmp);
  } catch { return []; }
});

ipcMain.handle('paste', () => clipboard.readText());
ipcMain.handle('copy', (_e, text) => clipboard.writeText(String(text)));

// Spotify import. Errors go back to the page as { error } so it can show the message.
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return { error: e.message || String(e) }; } };
ipcMain.handle('spotify:status', () => ({ ...spotify.status(), redirect: spotifyRedirect() }));
ipcMain.handle('spotify:login', safe((_e, clientId) => {
  if (!/^[0-9a-f]{32}$/i.test(clientId || '')) throw new Error('Le Client ID fait 32 caractères (chiffres et lettres a à f).');
  return spotify.login(clientId, spotifyRedirect(), win);
}));
ipcMain.handle('spotify:logout', () => spotify.logout());
ipcMain.handle('spotify:playlists', safe(() => spotify.playlists()));
ipcMain.handle('spotify:tracks', safe((_e, id) => spotify.tracks(id)));
ipcMain.on('discord', (_e, id, activity) => discord.set(id, activity));
ipcMain.on('pin', (_e, on) => win?.setAlwaysOnTop(!!on));

// Media keys of the keyboard (play/pause, next, previous) work even when SoundWave is in the background.
ipcMain.on('mediaKeys', (_e, on) => {
  globalShortcut.unregisterAll();
  if (!on) return;
  for (const [key, action] of [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev']]) {
    try { globalShortcut.register(key, () => send('media', action)); } catch {} // another app may own the key
  }
});

// Equalizer: a hidden window captures the player window's sound (Chromium mutes the original while it does),
// applies the EQ and plays it. Closing that window gives the original sound back.
let eqWin = null, eqSettings = null;
function startEq() {
  eqWin = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false } });
  eqWin.on('closed', () => { eqWin = null; });
  eqWin.webContents.once('did-finish-load', () => {
    eqWin.webContents.send('eq', eqSettings);
    eqWin.webContents.executeJavaScript('start()', true).catch(() => {});
  });
  eqWin.loadFile(path.join(__dirname, 'eq.html'));
}
const stopEq = () => { if (eqWin) eqWin.destroy(); eqWin = null; };
ipcMain.on('eq', (_e, s) => {
  eqSettings = s;
  if (!s || !s.on) return stopEq();
  if (eqWin) eqWin.webContents.send('eq', s); else startEq();
});
ipcMain.on('eqStatus', (_e, v) => { if (!v.ok) stopEq(); send('eqStatus', v); });

// Windows taskbar: previous / play-pause / next buttons on the window thumbnail.
const tbIcon = (n) => nativeImage.createFromPath(path.join(__dirname, 'assets', `tb-${n}.png`));
ipcMain.on('playing', (_e, playing) => {
  trayPlaying = playing; trayMenu();
  if (process.platform !== 'win32' || !win) return;
  win.setThumbarButtons([
    { tooltip: 'Précédent', icon: tbIcon('prev'), click: () => send('media', 'prev') },
    { tooltip: playing ? 'Pause' : 'Lecture', icon: tbIcon(playing ? 'pause' : 'play'), click: () => send('media', 'toggle') },
    { tooltip: 'Suivant', icon: tbIcon('next'), click: () => send('media', 'next') },
  ]);
});

if (process.platform === 'win32') app.setAppUserModelId('app.soundwave'); // taskbar name and icon

// One SoundWave at a time: opening it again just brings the running one back.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => showWin());

// Closing the window keeps the music going in the notification area (bottom right); "Quitter" really quits.
let tray = null, quitting = false, trayPlaying = false;
const showWin = () => { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); };
// Tray texts follow Windows' language (the window has its own setting).
const TRAY = {
  fr: ['Ouvrir SoundWave', 'Précédent', 'Pause', 'Lecture', 'Suivant', 'Quitter', 'SoundWave continue', "La musique continue ici. Clic droit sur l'icône → Quitter pour fermer."],
  en: ['Open SoundWave', 'Previous', 'Pause', 'Play', 'Next', 'Quit', 'SoundWave is still playing', 'The music keeps going here. Right-click the icon → Quit to close.'],
  es: ['Abrir SoundWave', 'Anterior', 'Pausa', 'Reproducir', 'Siguiente', 'Salir', 'SoundWave sigue sonando', 'La música sigue aquí. Clic derecho en el icono → Salir para cerrar.'],
};
const trayText = () => TRAY[app.getLocale().slice(0, 2)] || TRAY.en;
function trayMenu() {
  const [open, prev, pause, play, next, quit] = trayText();
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: open, click: showWin },
    { type: 'separator' },
    { label: prev, click: () => send('media', 'prev') },
    { label: trayPlaying ? pause : play, click: () => send('media', 'toggle') },
    { label: next, click: () => send('media', 'next') },
    { type: 'separator' },
    { label: quit, click: () => { quitting = true; app.quit(); } },
  ]));
}
function makeTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('SoundWave');
  tray.on('click', showWin);
  trayMenu();
}
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(async () => {
  // Hidden menu bar, but its Edit shortcuts (Ctrl+C / Ctrl+V / Ctrl+A) keep working.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'viewMenu' }]));
  // shortcut: if the fixed port is taken, a random one works but forgets saved data; fine for one app.
  const port = serverPort = await serve(PORT).catch(() => serve(0));
  win = new BrowserWindow({
    width: 1240, height: 780, minWidth: 940, minHeight: 600,
    backgroundColor: '#0b0b10', title: 'SoundWave',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 38 },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // keeps the player ticking (crossfade, next song) while hidden in the notification area
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  makeTray();
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!tray.shownTip) { tray.shownTip = true; tray.displayBalloon?.({ title: trayText()[6], content: trayText()[7], iconType: 'info' }); }
  });
  // Only the equalizer window may capture, and only the player window's sound.
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    if (eqWin && win && req.frame && req.frame.url.endsWith('eq.html')) cb({ video: win.webContents.mainFrame, audio: win.webContents.mainFrame });
    else cb({});
  });
  win.on('closed', () => { stopEq(); app.quit(); }); // the hidden equalizer window must not keep the app alive
  // Right-click menu on text fields.
  win.webContents.on('context-menu', (_e, p) => {
    if (!p.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' },
      { role: 'paste', label: 'Coller' }, { type: 'separator' }, { role: 'selectAll', label: 'Tout sélectionner' },
    ]).popup({ window: win });
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // Light themes need dark window buttons.
  ipcMain.on('titlebar', (_e, color) => { try { win.setTitleBarOverlay({ symbolColor: color }); } catch {} });
  win.loadURL(`http://localhost:${port}/`); // YouTube accepts a localhost origin, not a bare IP
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
