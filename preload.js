const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  lyrics: (artist, title) => ipcRenderer.invoke('lyrics', artist, title),
  palette: (url) => ipcRenderer.invoke('palette', url),
  paste: () => ipcRenderer.invoke('paste'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  spotify: {
    status: () => ipcRenderer.invoke('spotify:status'),
    login: (clientId) => ipcRenderer.invoke('spotify:login', clientId),
    logout: () => ipcRenderer.invoke('spotify:logout'),
    playlists: () => ipcRenderer.invoke('spotify:playlists'),
    tracks: (id) => ipcRenderer.invoke('spotify:tracks', id),
  },
  discord: (id, activity) => ipcRenderer.send('discord', id, activity),
  pin: (on) => ipcRenderer.send('pin', on),
  mediaKeys: (on) => ipcRenderer.send('mediaKeys', on),
  playing: (on) => ipcRenderer.send('playing', on),
  titlebar: (color) => ipcRenderer.send('titlebar', color),
  eq: (s) => ipcRenderer.send('eq', s),
  onEq: (fn) => ipcRenderer.on('eq', (_e, s) => fn(s)),
  eqStatus: (v) => ipcRenderer.send('eqStatus', v),
  onEqStatus: (fn) => ipcRenderer.on('eqStatus', (_e, v) => fn(v)),
  onMedia: (fn) => ipcRenderer.on('media', (_e, action) => fn(action)),
});
