// Pure helpers shared by player.html (via <script>) and test.js (via require).
(function (root) {
  const NOISE = /\s*[\(\[][^\)\]]*(official|video|audio|lyric|clip|visuali[sz]er|music|hd|4k|explicit|remaster)[^\)\]]*[\)\]]/gi;

  // "Lil Baby & Gunna - Drip Too Hard (Official Video)" -> { artist, title }
  function splitTitle(videoTitle, channel = '') {
    const clean = videoTitle.replace(NOISE, '').replace(/\s+/g, ' ').trim();
    const m = clean.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
    if (m) return { artist: m[1].trim(), title: m[2].trim() };
    return { artist: channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim(), title: clean };
  }

  // LRC text -> [{ t: seconds, text }] sorted by time.
  function parseLrc(lrc) {
    const out = [];
    for (const line of (lrc || '').split(/\r?\n/)) {
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      for (const [, m, s] of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) out.push({ t: +m * 60 + +s, text });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // Index of the lyric line showing at time t, or -1 before the first line.
  function lineAt(lines, t) {
    let i = -1;
    while (i + 1 < lines.length && lines[i + 1].t <= t) i++;
    return i;
  }

  const fmtTime = (s) => (isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

  // Playlists: { id, name, tracks: [{ id, title, artist, year, thumb }] }. No duplicates by video id.
  function addTo(pl, t) {
    if (pl.tracks.some((x) => x.id === t.id)) return false;
    pl.tracks.push({ id: t.id, title: t.title, artist: t.artist, year: t.year, thumb: t.thumb });
    return true;
  }
  function removeFrom(pl, id) {
    const n = pl.tracks.length;
    pl.tracks = pl.tracks.filter((x) => x.id !== id);
    return pl.tracks.length !== n;
  }
  // History: newest first, no duplicates, capped.
  function pushRecent(pl, t, max = 50) {
    removeFrom(pl, t.id);
    addTo(pl, t);
    pl.tracks.unshift(pl.tracks.pop());
    pl.tracks.length = Math.min(pl.tracks.length, max);
  }
  // Move an item inside an array (drag & drop reordering).
  function move(arr, from, to) {
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    return arr;
  }
  // Saved data can be missing or hand-edited: always hand back a valid list with the built-in playlists first.
  const BUILTIN = [{ id: 'liked', name: 'Titres likés' }, { id: 'recent', name: 'Récemment écoutés' }];
  function loadPlaylists(json) {
    let lists = [];
    try { lists = JSON.parse(json) || []; } catch {}
    if (!Array.isArray(lists)) lists = [];
    lists = lists.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.tracks));
    const own = lists.filter((p) => !BUILTIN.some((b) => b.id === p.id));
    const built = BUILTIN.map((b) => lists.find((p) => p.id === b.id) || { ...b, tracks: [] });
    return [...built, ...own];
  }

  // Dominant vivid colors of an image. rgba = flat RGBA array (e.g. ImageData.data or a bitmap).
  function palette(rgba, count = 3) {
    const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0, val = max / 255;
      const w = sat * sat * val; // favor colorful, bright pixels
      if (w < 0.05) continue;
      const bk = buckets[Math.floor(hue(r, g, b) / 30) % 12];
      bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
    }
    return buckets.filter((b) => b.w > 0).sort((a, b) => b.w - a.w).slice(0, count)
      .map((b) => vivid(b.r / b.w, b.g / b.w, b.b / b.w));
  }
  function hue(r, g, b) {
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    if (!d) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  function vivid(r, g, b) { // push toward full brightness so the color glows instead of looking muddy
    const k = 255 / Math.max(r, g, b, 1);
    return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  }

  // A Spotify playlist/library item -> Lueur track. Handles the new ("item") and old ("track") response shapes;
  // local files, podcasts and removed songs come back null.
  function mapSpotifyTrack(entry) {
    const t = entry && (entry.item || entry.track);
    if (!t || !t.id || (t.type && t.type !== 'track') || t.is_local) return null;
    const imgs = t.album?.images || [];
    const img = imgs.find((i) => i.width && i.width <= 320) || imgs[imgs.length > 1 ? 1 : 0] || imgs[0];
    return {
      id: 'sp:' + t.id,
      title: t.name || '',
      artist: (t.artists || []).map((a) => a.name).join(', '),
      year: (t.album?.release_date || '').slice(0, 4),
      thumb: img?.url || '',
    };
  }

  // Equalizer: 10 bands (dB), plus bass and treble shelves. Same values in the page and the audio window.
  const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const EQ_PRESETS = {
    plat:    { name: 'Plat',     bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    basses:  { name: 'Basses +', bands: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
    rap:     { name: 'Rap',      bands: [6, 5, 3, 1, -1, -1, 1, 2, 2, 1] },
    pop:     { name: 'Pop',      bands: [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1] },
    rock:    { name: 'Rock',     bands: [4, 3, 2, 0, -1, -1, 1, 3, 4, 4] },
    electro: { name: 'Électro',  bands: [5, 4, 2, 0, -2, 0, 1, 2, 4, 5] },
    voix:    { name: 'Voix',     bands: [-3, -2, -1, 1, 3, 4, 4, 3, 1, 0] },
    nuit:    { name: 'Nuit',     bands: [2, 2, 1, 0, -1, -2, -3, -4, -5, -6] },
  };
  const clampN = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
  // Saved settings may be missing or hand-edited: always return a valid equalizer state.
  function normalizeEq(e) {
    e = e && typeof e === 'object' ? e : {};
    const bands = Array.isArray(e.bands) && e.bands.length === 10 ? e.bands.map((b) => clampN(b, -12, 12)) : EQ_PRESETS.plat.bands.slice();
    return { on: !!e.on, preset: typeof e.preset === 'string' ? e.preset : 'plat', bands, bass: clampN(e.bass, 0, 12), treble: clampN(e.treble, -6, 9) };
  }
  // Lower the input by part of the biggest boost so loud songs don't distort (a limiter catches the rest).
  function eqHeadroom(e) {
    const lowBoost = Math.max(...e.bands.slice(0, 3)) + e.bass;
    const boost = Math.max(0, ...e.bands, lowBoost, e.treble);
    return -boost * 0.6;
  }

  // LRCLIB results -> synced versions, closest in length to the clip first (a different edit is what makes lyrics drift).
  function rankLyrics(items, duration, max = 6) {
    const seen = new Set(), out = [];
    for (const x of items || []) {
      if (!x || !x.syncedLyrics || seen.has(x.id)) continue;
      seen.add(x.id);
      out.push({ lrc: x.syncedLyrics, duration: +x.duration || 0, label: `${x.artistName || ''} – ${x.trackName || ''}`.trim() });
    }
    if (duration > 0) out.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
    return out.slice(0, max);
  }

  // Custom theme: colors as #rrggbb, a lyrics font key and light/dark. Anything invalid falls back to the default.
  const CUSTOM_DEFAULT = { base: '#0d0c12', b1: '#d9531e', b2: '#0f6f7a', b3: '#6a2a8a', accent: '#ffb36b', lyric: '#fff4e4', font: 'cooper', light: false };
  const LYRIC_FONTS = ['cooper', 'moderne', 'impact', 'serif', 'retro'];
  function normalizeCustom(c) {
    c = c && typeof c === 'object' ? c : {};
    const out = {};
    for (const k of ['base', 'b1', 'b2', 'b3', 'accent', 'lyric']) out[k] = /^#[0-9a-f]{6}$/i.test(c[k]) ? c[k].toLowerCase() : CUSTOM_DEFAULT[k];
    out.font = LYRIC_FONTS.includes(c.font) ? c.font : CUSTOM_DEFAULT.font;
    out.light = !!c.light;
    return out;
  }
  // Any CSS color the page computed ("rgb(255, 26, 26)" or "#abc") -> "#rrggbb", or null.
  function toHex(color) {
    const m = String(color).match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (m) return '#' + m.slice(1, 4).map((v) => Math.min(255, +v).toString(16).padStart(2, '0')).join('');
    const h = String(color).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!h) return null;
    return '#' + (h[1].length === 3 ? h[1].split('').map((x) => x + x).join('') : h[1]).toLowerCase();
  }

  // Queue: tracks added by hand carry queued: true and sit right after the current song, in the order they were added.
  // mode 'next' = play right after the current song; 'end' = after the other hand-added songs. Returns the new index.
  function queueInsert(queue, now, track, mode) {
    let pos = now + 1;
    if (mode === 'end') while (pos < queue.length && queue[pos].queued) pos++;
    queue.splice(pos, 0, { ...track, queued: true });
    return pos;
  }
  // Move a song inside the queue and return where the current song ended up.
  function queueMove(queue, now, from, to) {
    const cur = queue[now];
    move(queue, from, to);
    return queue.indexOf(cur);
  }
  // Remove a song (never the one playing) and return the new index of the current song.
  function queueRemove(queue, now, i) {
    if (i === now || i < 0 || i >= queue.length) return now;
    queue.splice(i, 1);
    return i < now ? now - 1 : now;
  }

  // YouTube / YouTube Music playlist link (or bare id) -> playlist id, or null.
  function parsePlaylistId(text) {
    const s = String(text || '').trim();
    const m = s.match(/[?&]list=([\w-]{10,})/);
    if (m) return m[1];
    return /^(PL|OL|UU|FL|LL|VL|RD)[\w-]{10,}$/.test(s) ? s.replace(/^VL/, '') : null;
  }
  // playlistItems entry -> track, or null for deleted / private videos.
  function mapYtPlaylistItem(item, decode = (x) => x) {
    const sn = item && item.snippet, id = sn?.resourceId?.videoId;
    if (!id || /^(Deleted|Private) video$/i.test(sn.title || '')) return null;
    const channel = decode(sn.videoOwnerChannelTitle || '');
    return { id, ...splitTitle(decode(sn.title || ''), channel),
      year: (item.contentDetails?.videoPublishedAt || sn.publishedAt || '').slice(0, 4),
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  }

  // Search results -> channelId of the artist the user typed (channel named like the query), or null.
  // Prefers the artist's own channel over its "- Topic" / VEVO copies.
  const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*-\s*topic$/, '').replace(/vevo$/, '').replace(/\b(official|officiel)\b/g, '').replace(/[^a-z0-9]/g, '');
  function pickArtist(results, q) {
    const want = normName(q);
    if (!want) return null;
    let best = null, bestScore = 0;
    for (const r of results) {
      if (!r.channelId) continue;
      const name = normName(r.channel);
      const words = String(r.channel).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/);
      const score = (name === want ? 4 : (name.startsWith(want) || words.includes(want)) && want.length >= 3 ? 2 : 0) + (/topic$|vevo$/i.test(r.channel) ? 0 : 1);
      if (score > bestScore && score >= 2) { best = r.channelId; bestScore = score; }
    }
    return best;
  }

  // Translations of the French texts of the app (keys with {0} match any text there). French stays the source.
  const I18N = {
    en: {
      "Aurore boréale": "Northern lights",
      "Lave": "Lava",
      "Forêt": "Forest",
      "Or": "Gold",
      "Lavande": "Lavender",
      "Bonbon": "Candy",
      "Papier": "Paper",
      "Paroles": "Lyrics",
      "Aléatoire": "Shuffle",
      "Lecture aléatoire": "Shuffle play",
      "File d'attente": "Queue",
      "Retour": "Back",
      "Retour aux playlists": "Back to playlists",
      "Lire en aléatoire": "Shuffle",
      "Renommer": "Rename",
      "Renommer la playlist": "Rename playlist",
      "Supprimer": "Delete",
      "Supprimer la playlist": "Delete playlist",
      "Lire": "Play",
      "Lire la playlist": "Play playlist",
      "Titres de la playlist": "Playlist songs",
      "Pochettes": "Covers",
      "Retour aux résultats": "Back to results",
      "Fermer (Échap)": "Close (Esc)",
      "Fermer les résultats": "Close results",
      "Rechercher": "Search",
      "Rechercher sur YouTube": "Search YouTube",
      "Ouvrir sur YouTube": "Open on YouTube",
      "Ouvrir le titre sur YouTube": "Open the song on YouTube",
      "Précédent": "Previous",
      "Lecture": "Play",
      "Suivant": "Next",
      "Répéter": "Repeat",
      "Répéter tout": "Repeat all",
      "Répéter ce titre": "Repeat this song",
      "Répéter : non": "Repeat: off",
      "Minuterie de sommeil": "Sleep timer",
      "Progression": "Progress",
      "J'aime": "Like",
      "Ajouter aux titres likés": "Add to liked songs",
      "Plus": "More",
      "Plus d'options": "More options",
      "Paroles (P)": "Lyrics (P)",
      "Égaliseur (basses, aigus…)": "Equalizer (bass, treble…)",
      "Égaliseur": "Equalizer",
      "Thèmes et réglages": "Themes and settings",
      "Volume (clic : couper)": "Volume (click: mute)",
      "Couper le son": "Mute",
      "Tout cacher, clip seul (C)": "Hide everything, video only (C)",
      "Tout cacher et afficher seulement le clip": "Hide everything and show only the video",
      "Activer l'égaliseur": "Turn on the equalizer",
      "Mode clair": "Light mode",
      "Clé YouTube": "YouTube key",
      "Fermer": "Close",
      "Client ID Spotify": "Spotify Client ID",
      "Client ID (32 caractères)": "Client ID (32 characters)",
      "Quitter le mode clip seul": "Leave video-only mode",
      "Quitter le mode clip (Échap)": "Leave video mode (Esc)",
      "Lance un titre": "Play a song",
      "En cours": "Now playing",
      "Cherche un artiste pour commencer": "Search for an artist to start",
      "+ Nouvelle playlist": "+ New playlist",
      "Importer depuis Spotify": "Import from Spotify",
      "Importer une playlist YouTube": "Import a YouTube playlist",
      "Glisse un titre pour changer l'ordre.": "Drag a song to reorder.",
      "Cherche un artiste ou un titre ↓": "Search for an artist or a song ↓",
      "Tout lire": "Play all",
      "Ajouter à une playlist…": "Add to a playlist…",
      "Ajouter à une playlist": "Add to a playlist",
      "Copier le lien": "Copy link",
      "Désactivé": "Off",
      "Désactivée": "Off",
      "Basses": "Bass",
      "Aigus": "Treble",
      "Le son passe par l'égaliseur avec un tout petit décalage.": "Sound goes through the equalizer with a tiny delay.",
      "réinitialiser": "reset",
      "Thème": "Theme",
      "Mon thème": "My theme",
      "Fond": "Background",
      "Couleur principale": "Main color",
      "Police des paroles": "Lyrics font",
      "Partir de": "Start from",
      "Choisir un thème…": "Choose a theme…",
      "Fond d'écran": "Background",
      "Clip": "Video",
      "Pochette": "Cover",
      "Effet du clip": "Video effect",
      "Net": "Sharp",
      "Ciné": "Cinema",
      "Flou": "Blur",
      "Qualité vidéo": "Video quality",
      "Max (jusqu'à 4K)": "Max (up to 4K)",
      "Fondu enchaîné": "Crossfade",
      "Non": "Off",
      "Taille des paroles": "Lyrics size",
      "Petite": "Small",
      "Moyenne": "Medium",
      "Grande": "Large",
      "Raccourcis": "Shortcuts",
      "Espace": "Space",
      "Lecture / pause": "Play / pause",
      "Parcourir les pochettes": "Browse covers",
      "Entrée": "Enter",
      "Lire la pochette du milieu": "Play the middle cover",
      "Maj + ← →": "Shift + ← →",
      "Reculer / avancer de 10 s": "Back / forward 10 s",
      "Afficher les paroles": "Show lyrics",
      "Clip seul (Échap pour revenir)": "Video only (Esc to go back)",
      "Langue": "Language",
      "Horloge": "Clock",
      "La grande heure au-dessus des pochettes.": "The big clock above the covers.",
      "Toujours au premier plan": "Always on top",
      "La fenêtre reste au-dessus des autres.": "The window stays above the others.",
      "Statut Discord": "Discord status",
      "Affiche « Écoute SoundWave » et le titre en cours sur ton profil.": "Shows “Listening to SoundWave” and the current song on your profile.",
      "Touches média du clavier": "Keyboard media keys",
      "Lecture, suivant, précédent, même en arrière-plan.": "Play, next, previous, even in the background.",
      "Effets visuels": "Visual effects",
      "Particules, relief des pochettes, animations.": "Particles, cover tilt, animations.",
      "Mode économie": "Saver mode",
      "Moins d'effets, pour les PC moins puissants.": "Fewer effects, for less powerful PCs.",
      "Importer mes playlists Spotify": "Import my Spotify playlists",
      "Connecte YouTube": "Connect YouTube",
      "SoundWave a besoin d'une clé YouTube gratuite pour chercher la musique. Ça prend 5 minutes, une seule fois :": "SoundWave needs a free YouTube key to search for music. It takes 5 minutes, only once:",
      "Ouvre": "Open",
      "et crée un projet (n'importe quel nom).": "and create a project (any name).",
      "Active": "Enable",
      "(bouton « Activer »).": "(“Enable” button).",
      "Va dans": "Go to",
      "Identifiants": "Credentials",
      "→ « Créer des identifiants » → « Clé API », puis copie-la ici.": "→ “Create credentials” → “API key”, then copy it here.",
      "Coller": "Paste",
      "Continuer": "Continue",
      "Annuler": "Cancel",
      "SoundWave lit tes playlists Spotify et les joue via YouTube. Il faut une clé Spotify (le compte qui la crée doit avoir Premium). À faire une seule fois :": "SoundWave reads your Spotify playlists and plays them through YouTube. It needs a Spotify key (the account that creates it must have Premium). Only once:",
      "Ouvre le": "Open the",
      "tableau de bord Spotify": "Spotify dashboard",
      ", connecte-toi et clique sur « Create app ».": ", log in and click “Create app”.",
      "Nom et description au choix. Dans « Redirect URIs », colle exactement": "Any name and description. In “Redirect URIs”, paste exactly",
      "copier": "copy",
      ", puis « Add ».": ", then “Add”.",
      "Coche « Web API », accepte les conditions et clique sur « Save ».": "Tick “Web API”, accept the terms and click “Save”.",
      "Dans l'appli, va dans « Settings », copie le « Client ID » et colle-le ici.": "In the app, go to “Settings”, copy the “Client ID” and paste it here.",
      "Se connecter à Spotify": "Log in to Spotify",
      "se déconnecter": "log out",
      "Coche ce que tu veux importer. Refaire un import met les playlists à jour.": "Tick what you want to import. Importing again updates the playlists.",
      "tout cocher": "select all",
      "Importer": "Import",
      "En lecture": "Now playing",
      "Titres likés": "Liked songs",
      "Récemment écoutés": "Recently played",
      "Dynamique": "Dynamic",
      "Coucher de soleil": "Sunset",
      "Néon": "Neon",
      "Vinyle": "Vinyl",
      "Océan": "Ocean",
      "Glace": "Ice",
      "Minuit": "Midnight",
      "Personnalisé": "Custom",
      "Arrondie (Cooper)": "Rounded (Cooper)",
      "Moderne": "Modern",
      "Élégante (italique)": "Elegant (italic)",
      "Rétro": "Retro",
      "Plat": "Flat",
      "Basses +": "Bass +",
      "Électro": "Electro",
      "Voix": "Vocals",
      "Nuit": "Night",
      "Perso": "Custom",
      "1 heure": "1 hour",
      "Fin du titre en cours": "End of current song",
      "Cherche un artiste ou ouvre une playlist.": "Search for an artist or open a playlist.",
      "Artiste": "Artist",
      "File d'attente et playlists": "Queue and playlists",
      "Recherche des paroles…": "Looking for lyrics…",
      "Pas de paroles synchronisées pour ce titre.": "No synced lyrics for this song.",
      "Les paroles du titre en cours s'afficheront ici.": "The lyrics of the current song will show here.",
      "Ajouté aux titres likés": "Added to liked songs",
      "Retiré des titres likés": "Removed from liked songs",
      "Lecture aléatoire activée": "Shuffle on",
      "Lecture aléatoire désactivée": "Shuffle off",
      "Son coupé": "Muted",
      "Son remis": "Sound on",
      "Lire ensuite": "Play next",
      "Ajouter à la file d'attente": "Add to queue",
      "Retirer de la file": "Remove from queue",
      "Nouvelle playlist…": "New playlist…",
      "Nouvelle playlist": "New playlist",
      "Tes playlists": "Your playlists",
      "FILE": "QUEUE",
      "Créer": "Create",
      "Retirer de la playlist": "Remove from playlist",
      "Supprimer la playlist ?": "Delete the playlist?",
      "Colle le lien de la playlist (YouTube ou YouTube Music). Elle doit être publique ou non répertoriée.": "Paste the playlist link (YouTube or YouTube Music). It must be public or unlisted.",
      "Import en cours…": "Importing…",
      "Le clip apparaît dès que la vidéo démarre.": "The video shows as soon as it starts.",
      "Adresse copiée": "Address copied",
      "Aucun résultat.": "No results.",
      "Ce lien ne contient pas de playlist (il faut « list=… »).": "This link has no playlist in it (it needs “list=…”).",
      "Ce titre est déjà en lecture.": "This song is already playing.",
      "Cette playlist est vide.": "This playlist is empty.",
      "Copie impossible": "Couldn't copy",
      "Déconnecté de Spotify": "Logged out of Spotify",
      "Je ne trouve pas ces titres sur YouTube.": "I can't find these songs on YouTube.",
      "Lance un titre d'abord.": "Play a song first.",
      "Les « Mix » YouTube sont générés pour toi et ne peuvent pas être importés.": "YouTube “Mixes” are made for you and can't be imported.",
      "Lien copié": "Link copied",
      "Limite de recherches YouTube du jour atteinte : les titres Spotify déjà écoutés marchent toujours.": "Daily YouTube search limit reached: Spotify songs you already played still work.",
      "Limite de recherches YouTube du jour atteinte. Tes playlists marchent toujours.": "Daily YouTube search limit reached. Your playlists still work.",
      "Limite YouTube du jour atteinte, réessaie demain.": "Daily YouTube limit reached, try again tomorrow.",
      "Minuterie terminée. Bonne nuit 🌙": "Timer done. Good night 🌙",
      "Pas de connexion internet ?": "No internet connection?",
      "Relance SoundWave pour activer Spotify.": "Restart SoundWave to turn on Spotify.",
      "Tes titres likés et « À regarder plus tard » sont toujours privés : crée une playlist avec ces titres et mets-la en « Non répertoriée ».": "Your liked videos and “Watch later” are always private: make a playlist with those songs and set it to “Unlisted”.",
      "Égaliseur activé": "Equalizer on",
      "Égaliseur désactivé": "Equalizer off",
      "La musique s'arrêtera à la fin de ce titre.": "Music will stop at the end of this song.",
      "Ajoute d'abord ta clé YouTube.": "Add your YouTube key first.",
      "Cette playlist est vide pour YouTube (ou privée).": "This playlist is empty for YouTube (or private).",
      "Playlist privée : sur YouTube, mets-la en « Non répertoriée » (Modifier → Visibilité), puis réessaie.": "Private playlist: on YouTube, set it to “Unlisted” (Edit → Visibility), then try again.",
      "Le Client ID fait 32 caractères (chiffres et lettres a à f).": "The Client ID is 32 characters (digits and letters a to f).",
      "Pas connecté à Spotify": "Not logged in to Spotify",
      "Connexion annulée.": "Login cancelled.",
      "Réponse Spotify invalide, réessaie.": "Invalid Spotify answer, try again.",
      "Spotify refuse l'accès (403). Vérifie que ton compte est bien ajouté dans « User Management » de ton appli Spotify, et que le propriétaire de l'appli a Premium.": "Spotify denies access (403). Check that your account is added under “User Management” in your Spotify app, and that the app owner has Premium.",
      "Ça ne ressemble pas à une clé (elle commence par « AIza »).": "That doesn't look like a key (it starts with “AIza”).",
      "Chargement de tes playlists…": "Loading your playlists…",
      "Tes titres likés": "Your liked songs",
      "Playlist d'un autre compte : Spotify ne la partage pas avec les applis": "Another account's playlist: Spotify doesn't share it with apps",
      "Les titres que tu écoutes apparaîtront ici.": "Songs you play will show up here.",
      "Aucun titre pour l'instant. Utilise le + à côté d'un titre, ou « … » dans la barre de lecture.": "No songs yet. Use the + next to a song, or “…” in the player bar.",
      "Écouter sur YouTube": "Listen on YouTube",
      "Playlist YouTube": "YouTube playlist",
      "La capture du son s'est arrêtée.": "Sound capture stopped.",
      "Connexion… (termine dans la fenêtre Spotify)": "Connecting… (finish in the Spotify window)",
      "Résultats pour « {0} »": "Results for “{0}”",
      "Écouter {0}": "Play {0}",
      "Voir l'artiste {0}": "See artist {0}",
      "À suivre · {0}": "Up next · {0}",
      "Playlist « {0} »": "Playlist “{0}”",
      "Lire ensuite : {0}": "Playing next: {0}",
      "Ajouté à la file : {0}": "Added to queue: {0}",
      "Retiré de la file : {0}": "Removed from queue: {0}",
      "Ajouté à « {0} »": "Added to “{0}”",
      "Déjà dans « {0} »": "Already in “{0}”",
      "Retiré de « {0} »": "Removed from “{0}”",
      "« {0} » et ses {1} seront supprimés. Les vidéos restent sur YouTube.": "“{0}” and its {1} will be deleted. The videos stay on YouTube.",
      "« {0} » importée ({1} titres) — YouTube a coupé la suite : {2}": "“{0}” imported ({1} songs) — YouTube cut off the rest: {2}",
      "« {0} » importée ({1} titres)": "“{0}” imported ({1} songs)",
      "{0} playlists importées ({1} titres)": "{0} playlists imported ({1} songs)",
      "{0} playlist importée ({1} titres)": "{0} playlist imported ({1} songs)",
      "Import… {0} titres": "Importing… {0} songs",
      "Import de « {0} » ({1})…": "Importing “{0}” ({1})…",
      "Arrêt dans {0}": "Stops in {0}",
      "La musique s'arrêtera dans {0} min.": "Music will stop in {0} min.",
      "Activé · {0}": "On · {0}",
      "Aucun titre trouvé sur la chaîne de {0}.": "No songs found on {0}'s channel.",
      "Cette vidéo ne peut pas être lue ici (code {0}), je passe à la suivante.": "This video can't be played here (code {0}), skipping to the next one.",
      "YouTube refuse la lecture dans SoundWave (code {0}). Envoie-moi ce code.": "YouTube refuses playback in SoundWave (code {0}).",
      "« {0} » introuvable sur YouTube, je passe au suivant.": "“{0}” not found on YouTube, skipping to the next one.",
      "Adresse de retour refusée : vérifie que « {0} » est bien dans les Redirect URIs de ton appli.": "Redirect address refused: check that “{0}” is in your app's Redirect URIs.",
      "Connecté en tant que {0}": "Logged in as {0}",
      "Clé refusée par YouTube : {0}": "Key refused by YouTube: {0}",
      "Égaliseur indisponible : {0}": "Equalizer unavailable: {0}",
      "YouTube : {0}": "YouTube: {0}",
      "Erreur Spotify ({0})": "Spotify error ({0})",
      "Spotify a refusé ({0})": "Spotify refused ({0})",
      "{0} titres": "{0} songs",
      "{0} titre": "{0} song",
      "{0} · clique sur un titre pour l'écouter": "{0} · click a song to play it",
      "{0} · déjà importée": "{0} · already imported",
      "{0} · {1}": "{0} · {1}",
      "{0} — {1}": "{0} — {1}"
    },
    es: {
      "Aurore boréale": "Aurora boreal",
      "Lave": "Lava",
      "Forêt": "Bosque",
      "Or": "Oro",
      "Lavande": "Lavanda",
      "Bonbon": "Caramelo",
      "Papier": "Papel",
      "Paroles": "Letra",
      "Aléatoire": "Aleatorio",
      "Lecture aléatoire": "Reproducción aleatoria",
      "File d'attente": "Cola",
      "Retour": "Atrás",
      "Retour aux playlists": "Volver a las playlists",
      "Lire en aléatoire": "Reproducir aleatorio",
      "Renommer": "Renombrar",
      "Renommer la playlist": "Renombrar playlist",
      "Supprimer": "Eliminar",
      "Supprimer la playlist": "Eliminar playlist",
      "Lire": "Reproducir",
      "Lire la playlist": "Reproducir playlist",
      "Titres de la playlist": "Canciones de la playlist",
      "Pochettes": "Portadas",
      "Retour aux résultats": "Volver a los resultados",
      "Fermer (Échap)": "Cerrar (Esc)",
      "Fermer les résultats": "Cerrar resultados",
      "Rechercher": "Buscar",
      "Rechercher sur YouTube": "Buscar en YouTube",
      "Ouvrir sur YouTube": "Abrir en YouTube",
      "Ouvrir le titre sur YouTube": "Abrir la canción en YouTube",
      "Précédent": "Anterior",
      "Lecture": "Reproducir",
      "Pause": "Pausa",
      "Suivant": "Siguiente",
      "Répéter": "Repetir",
      "Répéter tout": "Repetir todo",
      "Répéter ce titre": "Repetir esta canción",
      "Répéter : non": "Repetir: no",
      "Minuterie de sommeil": "Temporizador",
      "Progression": "Progreso",
      "J'aime": "Me gusta",
      "Ajouter aux titres likés": "Añadir a Me gusta",
      "Plus": "Más",
      "Plus d'options": "Más opciones",
      "Paroles (P)": "Letra (P)",
      "Égaliseur (basses, aigus…)": "Ecualizador (graves, agudos…)",
      "Égaliseur": "Ecualizador",
      "Thèmes et réglages": "Temas y ajustes",
      "Volume (clic : couper)": "Volumen (clic: silenciar)",
      "Couper le son": "Silenciar",
      "Volume": "Volumen",
      "Tout cacher, clip seul (C)": "Ocultar todo, solo el vídeo (C)",
      "Tout cacher et afficher seulement le clip": "Ocultar todo y mostrar solo el vídeo",
      "Activer l'égaliseur": "Activar el ecualizador",
      "Mode clair": "Modo claro",
      "Clé YouTube": "Clave de YouTube",
      "Fermer": "Cerrar",
      "Client ID Spotify": "Client ID de Spotify",
      "Client ID (32 caractères)": "Client ID (32 caracteres)",
      "Quitter le mode clip seul": "Salir del modo solo vídeo",
      "Quitter le mode clip (Échap)": "Salir del modo vídeo (Esc)",
      "Lance un titre": "Pon una canción",
      "En cours": "En reproducción",
      "Cherche un artiste pour commencer": "Busca un artista para empezar",
      "+ Nouvelle playlist": "+ Nueva playlist",
      "Importer depuis Spotify": "Importar desde Spotify",
      "Importer une playlist YouTube": "Importar una playlist de YouTube",
      "Glisse un titre pour changer l'ordre.": "Arrastra una canción para cambiar el orden.",
      "Cherche un artiste ou un titre ↓": "Busca un artista o una canción ↓",
      "Tout lire": "Reproducir todo",
      "Ajouter à une playlist…": "Añadir a una playlist…",
      "Ajouter à une playlist": "Añadir a una playlist",
      "Copier le lien": "Copiar enlace",
      "Désactivé": "Desactivado",
      "Désactivée": "Desactivado",
      "Basses": "Graves",
      "Aigus": "Agudos",
      "Le son passe par l'égaliseur avec un tout petit décalage.": "El sonido pasa por el ecualizador con un retraso mínimo.",
      "réinitialiser": "restablecer",
      "Thème": "Tema",
      "Mon thème": "Mi tema",
      "Fond": "Fondo",
      "Couleur principale": "Color principal",
      "Police des paroles": "Fuente de la letra",
      "Choisir un thème…": "Elegir un tema…",
      "Fond d'écran": "Fondo de pantalla",
      "Clip": "Vídeo",
      "Pochette": "Portada",
      "Effet du clip": "Efecto del vídeo",
      "Net": "Nítido",
      "Ciné": "Cine",
      "Flou": "Desenfoque",
      "Qualité vidéo": "Calidad de vídeo",
      "Max (jusqu'à 4K)": "Máx. (hasta 4K)",
      "Fondu enchaîné": "Fundido encadenado",
      "Non": "No",
      "Taille des paroles": "Tamaño de la letra",
      "Petite": "Pequeña",
      "Moyenne": "Mediana",
      "Raccourcis": "Atajos",
      "Espace": "Espacio",
      "Lecture / pause": "Reproducir / pausa",
      "Parcourir les pochettes": "Recorrer las portadas",
      "Entrée": "Intro",
      "Lire la pochette du milieu": "Reproducir la portada central",
      "Maj + ← →": "Mayús + ← →",
      "Reculer / avancer de 10 s": "Retroceder / avanzar 10 s",
      "Afficher les paroles": "Mostrar la letra",
      "Clip seul (Échap pour revenir)": "Solo vídeo (Esc para volver)",
      "Langue": "Idioma",
      "Options": "Opciones",
      "Horloge": "Reloj",
      "La grande heure au-dessus des pochettes.": "El reloj grande sobre las portadas.",
      "Toujours au premier plan": "Siempre visible",
      "La fenêtre reste au-dessus des autres.": "La ventana queda por encima de las demás.",
      "Statut Discord": "Estado de Discord",
      "Affiche « Écoute SoundWave » et le titre en cours sur ton profil.": "Muestra «Escuchando SoundWave» y la canción actual en tu perfil.",
      "Touches média du clavier": "Teclas multimedia",
      "Lecture, suivant, précédent, même en arrière-plan.": "Reproducir, siguiente, anterior, incluso en segundo plano.",
      "Effets visuels": "Efectos visuales",
      "Particules, relief des pochettes, animations.": "Partículas, relieve de portadas, animaciones.",
      "Mode économie": "Modo ahorro",
      "Moins d'effets, pour les PC moins puissants.": "Menos efectos, para PCs menos potentes.",
      "Importer mes playlists Spotify": "Importar mis playlists de Spotify",
      "Connecte YouTube": "Conecta YouTube",
      "SoundWave a besoin d'une clé YouTube gratuite pour chercher la musique. Ça prend 5 minutes, une seule fois :": "SoundWave necesita una clave gratuita de YouTube para buscar música. Son 5 minutos, una sola vez:",
      "Ouvre": "Abre",
      "et crée un projet (n'importe quel nom).": "y crea un proyecto (cualquier nombre).",
      "Active": "Activa",
      "(bouton « Activer »).": "(botón «Habilitar»).",
      "Va dans": "Ve a",
      "Identifiants": "Credenciales",
      "→ « Créer des identifiants » → « Clé API », puis copie-la ici.": "→ «Crear credenciales» → «Clave de API», y cópiala aquí.",
      "Coller": "Pegar",
      "Continuer": "Continuar",
      "Annuler": "Cancelar",
      "SoundWave lit tes playlists Spotify et les joue via YouTube. Il faut une clé Spotify (le compte qui la crée doit avoir Premium). À faire une seule fois :": "SoundWave lee tus playlists de Spotify y las reproduce con YouTube. Necesita una clave de Spotify (la cuenta que la crea debe tener Premium). Una sola vez:",
      "Ouvre le": "Abre el",
      "tableau de bord Spotify": "panel de Spotify",
      ", connecte-toi et clique sur « Create app ».": ", inicia sesión y haz clic en «Create app».",
      "Nom et description au choix. Dans « Redirect URIs », colle exactement": "Nombre y descripción a tu gusto. En «Redirect URIs», pega exactamente",
      "copier": "copiar",
      ", puis « Add ».": ", y luego «Add».",
      "Coche « Web API », accepte les conditions et clique sur « Save ».": "Marca «Web API», acepta las condiciones y haz clic en «Save».",
      "Dans l'appli, va dans « Settings », copie le « Client ID » et colle-le ici.": "En la app, ve a «Settings», copia el «Client ID» y pégalo aquí.",
      "Se connecter à Spotify": "Iniciar sesión en Spotify",
      "se déconnecter": "cerrar sesión",
      "Coche ce que tu veux importer. Refaire un import met les playlists à jour.": "Marca lo que quieras importar. Volver a importar actualiza las playlists.",
      "tout cocher": "marcar todo",
      "Importer": "Importar",
      "En lecture": "Sonando",
      "Titres likés": "Canciones que me gustan",
      "Récemment écoutés": "Escuchado recientemente",
      "Dynamique": "Dinámico",
      "Coucher de soleil": "Atardecer",
      "Néon": "Neón",
      "Vinyle": "Vinilo",
      "Océan": "Océano",
      "Glace": "Hielo",
      "Minuit": "Medianoche",
      "Personnalisé": "Personalizado",
      "Arrondie (Cooper)": "Redondeada (Cooper)",
      "Moderne": "Moderna",
      "Élégante (italique)": "Elegante (cursiva)",
      "Rétro": "Retro",
      "Plat": "Plano",
      "Basses +": "Graves +",
      "Électro": "Electro",
      "Voix": "Voz",
      "Nuit": "Noche",
      "Perso": "Personal",
      "15 minutes": "15 minutos",
      "30 minutes": "30 minutos",
      "1 heure": "1 hora",
      "Fin du titre en cours": "Fin de la canción actual",
      "Cherche un artiste ou ouvre une playlist.": "Busca un artista o abre una playlist.",
      "Artiste": "Artista",
      "File d'attente et playlists": "Cola y playlists",
      "Recherche des paroles…": "Buscando la letra…",
      "Pas de paroles synchronisées pour ce titre.": "No hay letra sincronizada para esta canción.",
      "Les paroles du titre en cours s'afficheront ici.": "La letra de la canción actual aparecerá aquí.",
      "Ajouté aux titres likés": "Añadida a Me gusta",
      "Retiré des titres likés": "Quitada de Me gusta",
      "Lecture aléatoire activée": "Aleatorio activado",
      "Lecture aléatoire désactivée": "Aleatorio desactivado",
      "Son coupé": "Silenciado",
      "Son remis": "Sonido activado",
      "Lire ensuite": "Reproducir a continuación",
      "Ajouter à la file d'attente": "Añadir a la cola",
      "Retirer de la file": "Quitar de la cola",
      "Nouvelle playlist…": "Nueva playlist…",
      "Nouvelle playlist": "Nueva playlist",
      "Tes playlists": "Tus playlists",
      "FILE": "COLA",
      "Créer": "Crear",
      "Retirer de la playlist": "Quitar de la playlist",
      "Supprimer la playlist ?": "¿Eliminar la playlist?",
      "Colle le lien de la playlist (YouTube ou YouTube Music). Elle doit être publique ou non répertoriée.": "Pega el enlace de la playlist (YouTube o YouTube Music). Debe ser pública o no listada.",
      "Import en cours…": "Importando…",
      "Le clip apparaît dès que la vidéo démarre.": "El vídeo aparece en cuanto empieza.",
      "Adresse copiée": "Dirección copiada",
      "Aucun résultat.": "Sin resultados.",
      "Ce lien ne contient pas de playlist (il faut « list=… »).": "Este enlace no contiene una playlist (necesita «list=…»).",
      "Ce titre est déjà en lecture.": "Esta canción ya está sonando.",
      "Cette playlist est vide.": "Esta playlist está vacía.",
      "Copie impossible": "No se pudo copiar",
      "Déconnecté de Spotify": "Sesión de Spotify cerrada",
      "Je ne trouve pas ces titres sur YouTube.": "No encuentro estas canciones en YouTube.",
      "Lance un titre d'abord.": "Pon una canción primero.",
      "Les « Mix » YouTube sont générés pour toi et ne peuvent pas être importés.": "Los «Mix» de YouTube se generan para ti y no se pueden importar.",
      "Lien copié": "Enlace copiado",
      "Limite de recherches YouTube du jour atteinte : les titres Spotify déjà écoutés marchent toujours.": "Límite diario de búsquedas de YouTube alcanzado: las canciones de Spotify ya escuchadas siguen funcionando.",
      "Limite de recherches YouTube du jour atteinte. Tes playlists marchent toujours.": "Límite diario de búsquedas de YouTube alcanzado. Tus playlists siguen funcionando.",
      "Limite YouTube du jour atteinte, réessaie demain.": "Límite diario de YouTube alcanzado, inténtalo mañana.",
      "Minuterie terminée. Bonne nuit 🌙": "Temporizador terminado. Buenas noches 🌙",
      "Pas de connexion internet ?": "¿Sin conexión a internet?",
      "Relance SoundWave pour activer Spotify.": "Reinicia SoundWave para activar Spotify.",
      "Tes titres likés et « À regarder plus tard » sont toujours privés : crée une playlist avec ces titres et mets-la en « Non répertoriée ».": "Tus vídeos que te gustan y «Ver más tarde» siempre son privados: crea una playlist con esas canciones y ponla como «No listada».",
      "Égaliseur activé": "Ecualizador activado",
      "Égaliseur désactivé": "Ecualizador desactivado",
      "La musique s'arrêtera à la fin de ce titre.": "La música se detendrá al final de esta canción.",
      "Ajoute d'abord ta clé YouTube.": "Añade primero tu clave de YouTube.",
      "Cette playlist est vide pour YouTube (ou privée).": "Esta playlist está vacía para YouTube (o es privada).",
      "Playlist privée : sur YouTube, mets-la en « Non répertoriée » (Modifier → Visibilité), puis réessaie.": "Playlist privada: en YouTube, ponla como «No listada» (Editar → Visibilidad) y vuelve a intentarlo.",
      "Le Client ID fait 32 caractères (chiffres et lettres a à f).": "El Client ID tiene 32 caracteres (números y letras de la a a la f).",
      "Pas connecté à Spotify": "Sin sesión en Spotify",
      "Connexion annulée.": "Inicio de sesión cancelado.",
      "Réponse Spotify invalide, réessaie.": "Respuesta de Spotify no válida, inténtalo de nuevo.",
      "Spotify refuse l'accès (403). Vérifie que ton compte est bien ajouté dans « User Management » de ton appli Spotify, et que le propriétaire de l'appli a Premium.": "Spotify deniega el acceso (403). Comprueba que tu cuenta está añadida en «User Management» de tu app de Spotify y que el propietario de la app tiene Premium.",
      "Ça ne ressemble pas à une clé (elle commence par « AIza »).": "Eso no parece una clave (empieza por «AIza»).",
      "Chargement de tes playlists…": "Cargando tus playlists…",
      "Tes titres likés": "Tus canciones que te gustan",
      "Playlist d'un autre compte : Spotify ne la partage pas avec les applis": "Playlist de otra cuenta: Spotify no la comparte con las apps",
      "Les titres que tu écoutes apparaîtront ici.": "Las canciones que escuches aparecerán aquí.",
      "Aucun titre pour l'instant. Utilise le + à côté d'un titre, ou « … » dans la barre de lecture.": "Aún no hay canciones. Usa el + junto a una canción, o «…» en la barra de reproducción.",
      "Écouter sur YouTube": "Escuchar en YouTube",
      "Playlist YouTube": "Playlist de YouTube",
      "La capture du son s'est arrêtée.": "La captura del sonido se detuvo.",
      "Connexion… (termine dans la fenêtre Spotify)": "Conectando… (termina en la ventana de Spotify)",
      "Résultats pour « {0} »": "Resultados de «{0}»",
      "Écouter {0}": "Escuchar {0}",
      "Voir l'artiste {0}": "Ver el artista {0}",
      "À suivre · {0}": "A continuación · {0}",
      "Playlist « {0} »": "Playlist «{0}»",
      "Lire ensuite : {0}": "A continuación: {0}",
      "Ajouté à la file : {0}": "Añadida a la cola: {0}",
      "Retiré de la file : {0}": "Quitada de la cola: {0}",
      "Ajouté à « {0} »": "Añadida a «{0}»",
      "Déjà dans « {0} »": "Ya está en «{0}»",
      "Retiré de « {0} »": "Quitada de «{0}»",
      "« {0} » et ses {1} seront supprimés. Les vidéos restent sur YouTube.": "«{0}» y sus {1} se eliminarán. Los vídeos siguen en YouTube.",
      "« {0} » importée ({1} titres) — YouTube a coupé la suite : {2}": "«{0}» importada ({1} canciones) — YouTube cortó el resto: {2}",
      "« {0} » importée ({1} titres)": "«{0}» importada ({1} canciones)",
      "{0} playlists importées ({1} titres)": "{0} playlists importadas ({1} canciones)",
      "{0} playlist importée ({1} titres)": "{0} playlist importada ({1} canciones)",
      "Import… {0} titres": "Importando… {0} canciones",
      "Import de « {0} » ({1})…": "Importando «{0}» ({1})…",
      "Arrêt dans {0}": "Se detiene en {0}",
      "La musique s'arrêtera dans {0} min.": "La música se detendrá en {0} min.",
      "Activé · {0}": "Activado · {0}",
      "Aucun titre trouvé sur la chaîne de {0}.": "No se encontraron canciones en el canal de {0}.",
      "Cette vidéo ne peut pas être lue ici (code {0}), je passe à la suivante.": "Este vídeo no se puede reproducir aquí (código {0}), paso al siguiente.",
      "YouTube refuse la lecture dans SoundWave (code {0}). Envoie-moi ce code.": "YouTube no permite reproducirlo en SoundWave (código {0}).",
      "« {0} » introuvable sur YouTube, je passe au suivant.": "«{0}» no está en YouTube, paso a la siguiente.",
      "Adresse de retour refusée : vérifie que « {0} » est bien dans les Redirect URIs de ton appli.": "Dirección de retorno rechazada: comprueba que «{0}» está en las Redirect URIs de tu app.",
      "Connecté en tant que {0}": "Conectado como {0}",
      "Clé refusée par YouTube : {0}": "Clave rechazada por YouTube: {0}",
      "Égaliseur indisponible : {0}": "Ecualizador no disponible: {0}",
      "YouTube : {0}": "YouTube: {0}",
      "Erreur Spotify ({0})": "Error de Spotify ({0})",
      "Spotify a refusé ({0})": "Spotify lo rechazó ({0})",
      "{0} titres": "{0} canciones",
      "{0} titre": "{0} canción",
      "{0} · clique sur un titre pour l'écouter": "{0} · haz clic en una canción para escucharla",
      "{0} · déjà importée": "{0} · ya importada",
      "{0} · {1}": "{0} · {1}",
      "{0} — {1}": "{0} — {1}"
    },
  };

  const api = { I18N, pickArtist, queueInsert, queueMove, queueRemove, parsePlaylistId, mapYtPlaylistItem, CUSTOM_DEFAULT, LYRIC_FONTS, normalizeCustom, toHex, rankLyrics, EQ_FREQS, EQ_PRESETS, normalizeEq, eqHeadroom, mapSpotifyTrack, splitTitle, parseLrc, lineAt, fmtTime, addTo, removeFrom, pushRecent, move, loadPlaylists, palette };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Lib = api;
})(this);
