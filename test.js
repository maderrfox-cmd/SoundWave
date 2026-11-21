const assert = require('assert');
const { splitTitle, parseLrc, lineAt, fmtTime, addTo, removeFrom, pushRecent, move, loadPlaylists, palette } = require('./player-lib');

// Playlists
const lists = loadPlaylists('not json');
assert.deepStrictEqual(lists.map((p) => p.id), ['liked', 'recent']);
assert.deepStrictEqual(loadPlaylists(JSON.stringify([{ id: 'p1', name: 'A', tracks: [] }, null, { id: 3 }])).map((p) => p.id), ['liked', 'recent', 'p1']);
const keptLiked = loadPlaylists(JSON.stringify([{ id: 'p1', name: 'A', tracks: [] }, { id: 'liked', name: 'Titres likés', tracks: [{ id: 'z' }] }]));
assert.deepStrictEqual(keptLiked.map((p) => p.id), ['liked', 'recent', 'p1']);
assert.strictEqual(keptLiked[0].tracks.length, 1); // saved likes survive

const recent = { id: 'recent', tracks: [] };
for (const id of ['a', 'b', 'c', 'a']) pushRecent(recent, { id }, 3);
assert.deepStrictEqual(recent.tracks.map((t) => t.id), ['a', 'c', 'b']);
pushRecent(recent, { id: 'd' }, 3);
assert.deepStrictEqual(recent.tracks.map((t) => t.id), ['d', 'a', 'c']);

assert.deepStrictEqual(move([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
assert.deepStrictEqual(move([1, 2, 3], 2, 0), [3, 1, 2]);
assert.deepStrictEqual(move([1, 2, 3], 5, 0), [1, 2, 3]);

const px = [];
for (let i = 0; i < 60; i++) px.push(200, 20, 20, 255);
for (let i = 0; i < 30; i++) px.push(20, 20, 180, 255);
for (let i = 0; i < 200; i++) px.push(128, 128, 128, 255);
assert.deepStrictEqual(palette(px), ['rgb(255,26,26)', 'rgb(28,28,255)']);
assert.deepStrictEqual(palette(new Array(400).fill(128)), []);
const pl = { id: 'p', name: 'x', tracks: [] };
const song = { id: 'v1', title: 'T', artist: 'A', year: '2020', thumb: 'u', extra: 'dropped' };
assert.strictEqual(addTo(pl, song), true);
assert.strictEqual(addTo(pl, song), false); // no duplicate
assert.deepStrictEqual(Object.keys(pl.tracks[0]), ['id', 'title', 'artist', 'year', 'thumb']);
assert.strictEqual(removeFrom(pl, 'v1'), true);
assert.strictEqual(removeFrom(pl, 'v1'), false);

assert.deepStrictEqual(splitTitle('Lil Baby & Gunna - Drip Too Hard (Official Video)'), { artist: 'Lil Baby & Gunna', title: 'Drip Too Hard' });
assert.deepStrictEqual(splitTitle('Ninho – Jefe [Clip Officiel]'), { artist: 'Ninho', title: 'Jefe' });
assert.deepStrictEqual(splitTitle('Grace', 'Lil Baby - Topic'), { artist: 'Lil Baby', title: 'Grace' });
assert.deepStrictEqual(splitTitle('Hats Off (feat. Travis Scott)', 'LilBabyVEVO'), { artist: 'LilBaby', title: 'Hats Off (feat. Travis Scott)' });

const lines = parseLrc('[00:01.50] I\'m gon\n[00:03.00][00:10.00] be up until the\n[ar:X]\n');
assert.deepStrictEqual(lines.map((l) => l.t), [1.5, 3, 10]);
assert.strictEqual(lines[1].text, 'be up until the');
assert.strictEqual(lineAt(lines, 0), -1);
assert.strictEqual(lineAt(lines, 3.2), 1);
assert.strictEqual(lineAt(lines, 99), 2);

assert.strictEqual(fmtTime(125.7), '2:05');
assert.strictEqual(fmtTime(NaN), '0:00');
// Spotify mapping
const { mapSpotifyTrack } = require('./player-lib');
const sp = { id: 'abc', type: 'track', name: 'Casanova', artists: [{ name: 'Soolking' }, { name: 'Gazo' }],
  album: { release_date: '2023-05-12', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] } };
assert.deepStrictEqual(mapSpotifyTrack({ item: sp }), { id: 'sp:abc', title: 'Casanova', artist: 'Soolking, Gazo', year: '2023', thumb: 'mid' });
assert.deepStrictEqual(mapSpotifyTrack({ track: sp }).id, 'sp:abc'); // old response shape
assert.strictEqual(mapSpotifyTrack({ item: { ...sp, type: 'episode' } }), null);
assert.strictEqual(mapSpotifyTrack({ item: { ...sp, is_local: true } }), null);
assert.strictEqual(mapSpotifyTrack({ item: null }), null);
assert.strictEqual(mapSpotifyTrack({ item: { ...sp, album: {} } }).thumb, '');
// Equalizer
const { normalizeEq, eqHeadroom, EQ_PRESETS, EQ_FREQS } = require('./player-lib');
assert.strictEqual(EQ_FREQS.length, 10);
for (const p of Object.values(EQ_PRESETS)) assert.strictEqual(p.bands.length, 10);
assert.deepStrictEqual(normalizeEq(null), { on: false, preset: 'plat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, treble: 0 });
const wild = normalizeEq({ on: 1, bands: [99, -99, 'x', 0, 0, 0, 0, 0, 0, 0], bass: 50, treble: -50 });
assert.deepStrictEqual(wild.bands.slice(0, 3), [12, -12, 0]);
assert.strictEqual(wild.bass, 12); assert.strictEqual(wild.treble, -6); assert.strictEqual(wild.on, true);
assert.strictEqual(normalizeEq({ bands: [1, 2] }).bands.length, 10); // wrong length -> flat
assert.strictEqual(eqHeadroom(normalizeEq({})), -0);
assert.ok(Math.abs(eqHeadroom(normalizeEq({ bands: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 6 })) - -7.2) < 1e-9); // 6 + 6 boost at the low end
// Lyrics ranking
const { rankLyrics } = require('./player-lib');
const items = [
  { id: 1, syncedLyrics: 'A', duration: 180, artistName: 'X', trackName: 'Radio edit' },
  { id: 2, syncedLyrics: null, duration: 215 },
  { id: 3, syncedLyrics: 'C', duration: 212, artistName: 'X', trackName: 'Clip' },
  { id: 1, syncedLyrics: 'A', duration: 180 },
];
assert.deepStrictEqual(rankLyrics(items, 214).map((c) => c.lrc), ['C', 'A']); // closest to the clip first, no dupes, synced only
assert.deepStrictEqual(rankLyrics(items, 0).map((c) => c.lrc), ['A', 'C']);   // unknown length: keep LRCLIB order
assert.strictEqual(rankLyrics(items, 214)[0].label, 'X – Clip');
assert.deepStrictEqual(rankLyrics(null, 100), []);
// Custom theme
const { normalizeCustom, toHex, CUSTOM_DEFAULT } = require('./player-lib');
assert.deepStrictEqual(normalizeCustom(null), CUSTOM_DEFAULT);
const ct = normalizeCustom({ base: '#ABCDEF', b1: 'red', accent: '#12345', font: 'impact', light: 1, extra: 'x' });
assert.strictEqual(ct.base, '#abcdef'); assert.strictEqual(ct.b1, CUSTOM_DEFAULT.b1); assert.strictEqual(ct.accent, CUSTOM_DEFAULT.accent);
assert.strictEqual(ct.font, 'impact'); assert.strictEqual(ct.light, true); assert.strictEqual(ct.extra, undefined);
assert.strictEqual(normalizeCustom({ font: 'comic' }).font, 'cooper');
assert.strictEqual(toHex('rgb(255, 26, 26)'), '#ff1a1a');
assert.strictEqual(toHex('#AbC'), '#aabbcc');
assert.strictEqual(toHex('#0d0c12'), '#0d0c12');
assert.strictEqual(toHex('blue'), null);
// Queue
const { queueInsert, queueMove, queueRemove, parsePlaylistId, mapYtPlaylistItem } = require('./player-lib');
const ids = (q) => q.map((t) => t.id).join('');
let q = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
assert.strictEqual(queueInsert(q, 1, { id: 'X' }, 'end'), 2);   // after current (b)
assert.strictEqual(queueInsert(q, 1, { id: 'Y' }, 'end'), 3);   // after X, keeps order
assert.strictEqual(queueInsert(q, 1, { id: 'Z' }, 'next'), 2);  // jumps ahead of X and Y
assert.strictEqual(ids(q), 'abZXYcd');
assert.ok(q[2].queued && !q[5].queued);
q = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
assert.strictEqual(queueMove(q, 1, 3, 0), 2);                   // d moved before a: current b shifts to 2
assert.strictEqual(ids(q), 'dabc');
assert.strictEqual(queueMove(q, 2, 2, 3), 3);                   // moving the current song itself
assert.strictEqual(queueRemove(q, 3, 0), 2);                    // removing before current shifts it
assert.strictEqual(ids(q), 'acb');
assert.strictEqual(queueRemove(q, 2, 2), 2);                    // can't remove the playing song
assert.strictEqual(q.length, 3);

// YouTube playlist import
assert.strictEqual(parsePlaylistId('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'), 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
assert.strictEqual(parsePlaylistId('https://music.youtube.com/playlist?list=OLAK5uy_kV2bTxV1D4R6TtqkXzQJQ6r6Q9e9p2b9Y&si=abc'), 'OLAK5uy_kV2bTxV1D4R6TtqkXzQJQ6r6Q9e9p2b9Y');
assert.strictEqual(parsePlaylistId('https://www.youtube.com/watch?v=abc&list=PLabcdefghijk&index=2'), 'PLabcdefghijk');
assert.strictEqual(parsePlaylistId('PLabcdefghijkl'), 'PLabcdefghijkl');
assert.strictEqual(parsePlaylistId('https://youtube.com/watch?v=abc'), null);
assert.deepStrictEqual(mapYtPlaylistItem({ snippet: { title: 'Ninho - Jefe (Clip officiel)', videoOwnerChannelTitle: 'Ninho', resourceId: { videoId: 'v1' } },
  contentDetails: { videoPublishedAt: '2021-12-03T00:00:00Z' } }),
  { id: 'v1', artist: 'Ninho', title: 'Jefe', year: '2021', thumb: 'https://i.ytimg.com/vi/v1/hqdefault.jpg' });
assert.strictEqual(mapYtPlaylistItem({ snippet: { title: 'Deleted video', resourceId: { videoId: 'v2' } } }), null);
assert.strictEqual(mapYtPlaylistItem({ snippet: { title: 'x', resourceId: {} } }), null);
console.log('ok');

// pickArtist
{
  const { pickArtist } = require('./player-lib');
  const r = [{ channelId: 'L', channel: 'Rec. 118' }, { channelId: 'T', channel: 'PRN - Topic' }, { channelId: 'P', channel: 'PRN' }];
  assert.strictEqual(pickArtist(r, 'prn'), 'P');
  assert.strictEqual(pickArtist(r.slice(0, 2), 'prn'), 'T');
  assert.strictEqual(pickArtist(r, 'jul'), null);
  assert.strictEqual(pickArtist([{ channelId: 'J', channel: 'JuL Officiel' }], 'Jul'), 'J');
  assert.strictEqual(pickArtist([{ channelId: 'N', channel: 'NinhoVEVO' }], 'ninho'), 'N');
  assert.strictEqual(pickArtist([{ channelId: 'A', channel: 'Az PRN' }], 'prn'), 'A'); // artist name is one word of the channel
  assert.strictEqual(pickArtist([{ channelId: 'X', channel: 'Prnstar' }], 'prn'), 'X'); // prefix still counts
  console.log('ok pickArtist');
}
