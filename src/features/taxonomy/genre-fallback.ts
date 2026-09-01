import { normalized } from "@/features/scanner/normalize";

const knownEntries: Array<[string, string[]]> = [
  ["Alicia Keys\0Songs In A Minor (Deluxe Edition)", ["R&B", "Soul"]],
  ["Cage The Elephant\0Melophobia", ["Alternative Rock", "Indie Rock"]],
  ["Cat Stevens\0Buddha And The Chocolate Box", ["Folk Rock", "Singer-Songwriter"]],
  ["DJ Krush\0Butterfly Effect", ["Trip-Hop", "Instrumental Hip-Hop"]],
  ["Faces\0The Complete Faces: 1971-1973", ["Rock", "Blues Rock"]],
  ["Jefferson Airplane\0Surrealistic Pillow", ["Psychedelic Rock", "Folk Rock"]],
  ["Ott\0Fairchildren", ["Psybient", "Psydub"]],
  ["Phaeleh\0Tides", ["Future Garage", "Dubstep"]],
  ["TLC\0CrazySexyCool (30th Anniversary Edition)", ["R&B", "New Jack Swing"]],
  ["Weval\0Half Age EP", ["Electronic", "Downtempo"]],
  ["Zero 7\0Simple Things", ["Downtempo", "Trip-Hop"]],
];
const known = new Map<string, string[]>(knownEntries.map(([key, genres]) => [key.split("\0").map(normalized).join("\0"), genres]));

function ranked(values: string[]): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const name of values.map(value => value.trim()).filter(Boolean)) {
    const key = normalized(name), current = counts.get(key);
    counts.set(key, { name: current?.name ?? name, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)).slice(0, 2).map(item => item.name);
}

export function inferGenreFallback(artist: string, album: string, albumGenres: string[], artistGenres: string[]): string[] {
  return ranked(albumGenres).length ? ranked(albumGenres) : ranked(artistGenres).length ? ranked(artistGenres) : known.get(`${normalized(artist)}\0${normalized(album)}`) ?? [];
}
