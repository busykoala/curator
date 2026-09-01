import { db } from "@/features/db/client";

export type PlaylistOption = {
  value: string;
  label: string;
  group: string;
  count: number;
};

type Cache = {
  expires: number;
  value: ReturnType<typeof collect>;
};

let cache: Cache | undefined;

function human(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function collect() {
  const rows = db()
    .prepare(
      "SELECT p.profile_json,f.artist_name,f.album_name FROM track_profiles p JOIN files f ON f.id=p.file_id WHERE p.status='complete'",
    )
    .all() as Array<{
    profile_json: string;
    artist_name: string;
    album_name: string;
  }>;

  const counts = new Map<string, Map<string, number>>();
  const artists = new Map<string, number>();
  const albums = new Map<string, number>();

  function add(group: string, value: unknown) {
    if (typeof value !== "string" || !value.trim()) return;
    const bucket = counts.get(group) ?? new Map<string, number>();
    bucket.set(value, (bucket.get(value) ?? 0) + 1);
    counts.set(group, bucket);
  }

  for (const row of rows) {
    artists.set(row.artist_name, (artists.get(row.artist_name) ?? 0) + 1);
    albums.set(row.album_name, (albums.get(row.album_name) ?? 0) + 1);
    const profile = JSON.parse(row.profile_json) as Record<string, unknown>;
    for (const key of [
      "genre",
      "style",
      "mood",
      "listeningContexts",
      "scenes",
      "lyricalThemes",
      "texture",
      "timbre",
      "production",
      "dynamicCharacter",
      "structuralCharacter",
      "acousticElectronicCharacter",
      "energy",
    ]) {
      const values = Array.isArray(profile[key]) ? profile[key] : [profile[key]];
      for (const value of values) add(key, value);
    }
  }

  function options(
    key: string,
    group: string,
    limit = 200,
    minimum = 1,
  ): PlaylistOption[] {
    return [...(counts.get(key) ?? new Map()).entries()]
      .filter(([, count]) => count >= minimum)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([value, count]) => ({
        value,
        label: human(value),
        group,
        count,
      }));
  }

  const entityOptions = (
    values: Map<string, number>,
    group: string,
  ): PlaylistOption[] =>
    [...values.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([value, count]) => ({ value, label: value, group, count }));

  const genres = options("genre", "Genres", 80);
  const styles = options("style", "Styles & subgenres", 300, 2);
  const moods = options("mood", "Moods", 100);
  const contexts = options("listeningContexts", "Occasions", 100);
  const scenes = options("scenes", "Scenes", 180, 2);
  const themes = options("lyricalThemes", "Themes", 120, 2);
  const technical = [
    ...options("texture", "Texture", 80),
    ...options("timbre", "Timbre", 80),
    ...options("production", "Production", 80),
    ...options("dynamicCharacter", "Dynamics", 40),
    ...options("structuralCharacter", "Structure", 40),
    ...options("acousticElectronicCharacter", "Sound", 30),
    ...options("energy", "Energy", 10),
  ];
  const exclusions = [
    ...entityOptions(artists, "Artists"),
    ...entityOptions(albums, "Albums"),
    ...genres,
    ...styles,
  ];

  return {
    genres,
    styles,
    moods,
    contexts,
    scenes,
    themes,
    technical,
    exclusions,
  };
}

export function playlistOptions() {
  if (cache && cache.expires > Date.now()) return cache.value;
  const value = collect();
  cache = { value, expires: Date.now() + 5 * 60_000 };
  return value;
}
