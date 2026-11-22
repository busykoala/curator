import { db } from "@/features/db/client";
import { normalized } from "@/features/scanner/normalize";
import { audioModelResults, type AudioModelResult } from "@/features/audio-model/client";
import { FAMILIES, familyOf, resolveStyle, styleFromDiscogs, type Family, type Style } from "./style-map";

/** Bump to re-derive (and, where the result changes, rewrite) every album's GENRE/STYLE. */
export const GENRE_DERIVATION_VERSION = 2;

export type TrackGenreInput = {
  fileId: number;
  artist: string;
  audio?: Pick<AudioModelResult, "styles">;
  llmGenres: string[];
  llmStyles: string[];
  manual?: { genres?: string[]; styles?: string[] };
};
export type AlbumGenreInput = { albumKey: string; albumArtist: string; tracks: TrackGenreInput[]; musicbrainzTags: Array<{ name: string; count: number }>; appleGenre?: string; artistFamilies?: Record<string, number> };
export type TrackGenre = { fileId: number; family: Family; mainStyle?: Style; styles: Style[]; cluster: string; confidence: number; genreTag: string[]; styleTag: string[] };

type Scores = { family: Map<Family, number>; styles: Map<string, { style: Style; score: number }> };
const emptyScores = (): Scores => ({ family: new Map(), styles: new Map() });
function add(scores: Scores, style: Style | undefined, weight: number) {
  if (!style || !(weight > 0)) return;
  scores.family.set(style.family, (scores.family.get(style.family) ?? 0) + weight);
  const entry = scores.styles.get(style.key);
  if (entry) entry.score += weight; else scores.styles.set(style.key, { style, score: weight });
}
function addFamily(scores: Scores, family: Family | undefined, weight: number) {
  if (family && weight > 0) scores.family.set(family, (scores.family.get(family) ?? 0) + weight);
}
const total = (map: Map<Family, number>) => [...map.values()].reduce((sum, value) => sum + value, 0);
const share = (scores: Scores, family: Family) => (scores.family.get(family) ?? 0) / Math.max(total(scores.family), 1e-9);
const best = (map: Map<Family, number>) => [...map].sort((a, b) => b[1] - a[1] || FAMILIES.indexOf(a[0]) - FAMILIES.indexOf(b[0]))[0];

/** Evidence weights: hearing the recording beats catalogue tags, which beat the LLM's metadata guess. */
const WEIGHT = { audio: 1, musicbrainz: 0.8, apple: 0.3, llmWithAudio: 0.3, llmAlone: 1, artist: 0.4 };

function trackScores(track: TrackGenreInput, album: AlbumGenreInput): { all: Scores; audio: Scores } {
  const all = emptyScores(), audio = emptyScores();
  for (const { label, p } of track.audio?.styles ?? []) {
    if (p < 0.05) continue;
    const style = styleFromDiscogs(label);
    add(all, style, p * WEIGHT.audio);
    add(audio, style, p);
  }
  const tagTotal = album.musicbrainzTags.reduce((sum, tag) => sum + Math.max(1, tag.count), 0);
  for (const tag of album.musicbrainzTags) add(all, resolveStyle(tag.name), (WEIGHT.musicbrainz * Math.max(1, tag.count)) / Math.max(1, tagTotal));
  addFamily(all, album.appleGenre ? familyOf(album.appleGenre) : undefined, WEIGHT.apple);
  // The artist's other albums pull gently toward one family, so an artist does not split album by album.
  const artistTotal = Object.values(album.artistFamilies ?? {}).reduce((sum, value) => sum + value, 0);
  for (const [family, count] of Object.entries(album.artistFamilies ?? {})) addFamily(all, family as Family, (WEIGHT.artist * count) / Math.max(1, artistTotal));
  const llm = track.audio ? WEIGHT.llmWithAudio : WEIGHT.llmAlone;
  const llmFamily = track.llmGenres.map(familyOf).find(Boolean);
  for (const value of track.llmStyles) add(all, resolveStyle(value, llmFamily), llm / Math.max(1, track.llmStyles.length));
  addFamily(all, llmFamily, llm * 0.5);
  return { all, audio };
}

function stylesIn(scores: Scores, family: Family) {
  return [...scores.styles.values()].filter(entry => entry.style.family === family).sort((a, b) => b.score - a.score).map(entry => entry.style);
}

function isCompilation(album: AlbumGenreInput) {
  if (/^various( artists)?$/i.test(album.albumArtist.trim())) return true;
  const artists = new Set(album.tracks.map(track => normalized(track.artist)));
  return album.tracks.length >= 4 && artists.size / album.tracks.length > 0.5;
}

/**
 * Albums share one family and main style; a track only departs from the album
 * when its own recording clearly sounds like another family. Compilations are
 * decided per track. Manual genre/style overrides always win.
 */
export function deriveAlbumGenres(album: AlbumGenreInput): TrackGenre[] {
  const perTrack = album.tracks.map(track => ({ track, ...trackScores(track, album) }));
  const compilation = isCompilation(album);
  const albumScores = emptyScores();
  for (const { all } of perTrack) {
    const sum = Math.max(total(all.family), 1e-9);
    for (const [family, value] of all.family) albumScores.family.set(family, (albumScores.family.get(family) ?? 0) + value / sum);
    for (const entry of all.styles.values()) add({ family: new Map(), styles: albumScores.styles }, entry.style, entry.score / sum);
  }
  const albumFamily = best(albumScores.family)?.[0];
  const albumMain = albumFamily ? stylesIn(albumScores, albumFamily)[0] : undefined;
  return perTrack.map(({ track, all, audio }) => {
    const manualFamily = track.manual?.genres?.map(familyOf).find(Boolean);
    const own = best(all.family)?.[0];
    const audioOwn = best(audio.family);
    let family = manualFamily ?? (compilation ? own : albumFamily) ?? own ?? "World";
    if (!manualFamily && !compilation && albumFamily && audioOwn && audioOwn[0] !== albumFamily && share(audio, audioOwn[0]) >= 0.6 && share(audio, albumFamily) < 0.15) family = audioOwn[0];
    const manualStyles = (track.manual?.styles ?? []).map(value => resolveStyle(value, family)).filter((style): style is Style => Boolean(style));
    const ranked = manualStyles.length ? manualStyles : stylesIn(all, family);
    const mainStyle = manualStyles[0] ?? (!compilation && family === albumFamily && albumMain ? albumMain : ranked[0]);
    // STYLE describes the recording, so neighbouring families' styles may appear (e.g. Folk + "Folk Rock").
    const anyFamily = [...all.styles.values()].sort((a, b) => b.score - a.score).map(entry => entry.style);
    const styles = [...new Map([...manualStyles, ...ranked, ...anyFamily].map(style => [style.display, style])).values()].filter(style => style.display !== mainStyle?.display).slice(0, 3);
    const familyScores = [...all.family.values()].sort((a, b) => b - a);
    const confidence = Math.round(((familyScores[0] ?? 0) - (familyScores[1] ?? 0)) / Math.max(total(all.family), 1e-9) * 100) / 100;
    return {
      fileId: track.fileId,
      family,
      mainStyle,
      styles,
      cluster: mainStyle?.cluster ?? `${family.toLowerCase().replace(/[^a-z]+/g, "_")}.main`,
      confidence: manualFamily ? 1 : confidence,
      genreTag: mainStyle && mainStyle.display !== family ? [family, mainStyle.display] : [family],
      styleTag: styles.map(style => style.display),
    };
  });
}

const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const list = (value: unknown): string[] => (Array.isArray(value) ? value : value == null ? [] : [value]).map(String).filter(Boolean);

/** Release-group tags from stored MusicBrainz search evidence for the album's confirmed release group. */
function musicbrainzTags(albumKey: string, releaseGroupId: string | undefined) {
  if (!releaseGroupId) return [];
  const rows = db().prepare("SELECT payload_json FROM evidence WHERE provider='musicbrainz' AND entity_key=? ORDER BY fetched_at DESC LIMIT 6").all(albumKey) as Array<{ payload_json: string }>;
  for (const row of rows) {
    const group = (parse<{ "release-groups"?: Array<{ id: string; tags?: Array<{ name: string; count: number }> }> }>(row.payload_json, {})["release-groups"] ?? []).find(item => item.id === releaseGroupId);
    if (group?.tags?.length) return group.tags.slice(0, 12);
  }
  return [];
}
function appleGenre(albumKey: string, artist: string) {
  const rows = db().prepare("SELECT payload_json FROM evidence WHERE provider='apple' AND entity_key=? ORDER BY fetched_at DESC LIMIT 3").all(albumKey) as Array<{ payload_json: string }>;
  for (const row of rows) {
    const results = parse<Array<{ artistName?: string; primaryGenreName?: string }> | { results?: Array<{ artistName?: string; primaryGenreName?: string }> }>(row.payload_json, []);
    const items = Array.isArray(results) ? results : results.results ?? [];
    const match = items.find(item => item.artistName && normalized(item.artistName) === normalized(artist) && item.primaryGenreName);
    if (match) return match.primaryGenreName;
  }
  return undefined;
}

export function loadAlbumGenreInput(albumKey: string): AlbumGenreInput | undefined {
  const files = db().prepare(`SELECT f.id,f.artist_name,f.tags_json,p.profile_json,o.patch_json FROM files f
    LEFT JOIN track_profiles p ON p.file_id=f.id AND p.status IN ('complete','partial')
    LEFT JOIN track_profile_overrides o ON o.file_id=f.id WHERE f.album_key=? AND f.status IN ('analyzed','written') ORDER BY f.path`).all(albumKey) as Array<{ id: number; artist_name: string; tags_json: string; profile_json: string | null; patch_json: string | null }>;
  if (!files.length) return undefined;
  const tags = parse<Record<string, unknown>>(files[0].tags_json, {});
  const override = db().prepare("SELECT release_group_mbid FROM manual_overrides WHERE album_key=? AND confirmed=1").get(albumKey) as { release_group_mbid: string | null } | undefined;
  const extra = (tags.extraProperties ?? {}) as Record<string, unknown>;
  const releaseGroupId = override?.release_group_mbid ?? list(tags.musicbrainzReleaseGroupId)[0] ?? list(extra.MUSICBRAINZ_RELEASEGROUPID)[0];
  const albumArtist = list(tags.albumArtist)[0] ?? files[0].artist_name;
  const audio = audioModelResults(files.map(file => file.id));
  const artistFamilies = Object.fromEntries((db().prepare(`SELECT g.family,count(*) n FROM genre_derivations g JOIN files f ON f.id=g.file_id
    WHERE g.album_key<>? AND g.derivation_version=? AND lower(f.artist_name)=lower(?) GROUP BY g.family`).all(albumKey, GENRE_DERIVATION_VERSION, albumArtist) as Array<{ family: string; n: number }>).map(row => [row.family, row.n]));
  return {
    albumKey,
    albumArtist,
    artistFamilies,
    musicbrainzTags: musicbrainzTags(albumKey, releaseGroupId),
    appleGenre: appleGenre(albumKey, albumArtist),
    tracks: files.map(file => {
      const profile = parse<Record<string, unknown>>(file.profile_json, {}), manual = parse<Record<string, unknown>>(file.patch_json, {});
      const trackTags = parse<Record<string, unknown>>(file.tags_json, {});
      return {
        fileId: file.id,
        artist: list(trackTags.artist)[0] ?? file.artist_name,
        audio: audio.get(file.id),
        llmGenres: list(profile.genre),
        llmStyles: list(profile.style),
        manual: manual.genre || manual.style ? { genres: list(manual.genre), styles: list(manual.style) } : undefined,
      };
    }),
  };
}

/** Derive and persist an album's genres. Returns the derivations (empty when the album has no files). */
export function deriveAndStoreAlbum(albumKey: string): TrackGenre[] {
  const input = loadAlbumGenreInput(albumKey);
  if (!input) return [];
  const derived = deriveAlbumGenres(input);
  const upsert = db().prepare(`INSERT INTO genre_derivations(file_id,album_key,derivation_version,family,main_style,cluster,styles_json,genre_tag_json,style_tag_json,confidence,audio_based,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(file_id) DO UPDATE SET album_key=excluded.album_key,derivation_version=excluded.derivation_version,family=excluded.family,
    main_style=excluded.main_style,cluster=excluded.cluster,styles_json=excluded.styles_json,genre_tag_json=excluded.genre_tag_json,style_tag_json=excluded.style_tag_json,
    confidence=excluded.confidence,audio_based=excluded.audio_based,updated_at=CURRENT_TIMESTAMP`);
  const audioBased = new Set(input.tracks.filter(track => track.audio).map(track => track.fileId));
  db().transaction(() => {
    for (const track of derived) upsert.run(track.fileId, albumKey, GENRE_DERIVATION_VERSION, track.family, track.mainStyle?.display ?? null, track.cluster,
      JSON.stringify(track.styles.map(style => style.display)), JSON.stringify(track.genreTag), JSON.stringify(track.styleTag), track.confidence, audioBased.has(track.fileId) ? 1 : 0);
  })();
  return derived;
}

/** GENRE/STYLE tag values for a file, if derived. */
export function derivedTagProperties(fileId: number): { GENRE: string[]; STYLE: string[] } | undefined {
  const row = db().prepare("SELECT genre_tag_json,style_tag_json FROM genre_derivations WHERE file_id=? AND derivation_version=?").get(fileId, GENRE_DERIVATION_VERSION) as { genre_tag_json: string; style_tag_json: string } | undefined;
  return row ? { GENRE: parse<string[]>(row.genre_tag_json, []), STYLE: parse<string[]>(row.style_tag_json, []) } : undefined;
}
