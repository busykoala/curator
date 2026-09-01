import type {
  PlaylistConfig,
  PlaylistDefinition,
} from "./types";

export type ListeningProfile = {
  frequent?: Array<Record<string, unknown>>;
  starred?: Record<string, unknown>;
};

const semanticKeys = [
  "genre",
  "style",
  "mood",
  "scenes",
  "listeningContexts",
  "lyricalThemes",
  "texture",
  "timbre",
  "production",
  "instruments",
  "dynamicCharacter",
  "structuralCharacter",
  "acousticElectronicCharacter",
  "energy",
];

export function norm(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? [item] : []))
    : typeof value === "string"
      ? [value]
      : [];
}

function terms(profile: Record<string, unknown>) {
  return semanticKeys.flatMap((key) => list(profile[key])).map(norm);
}

function match(wanted: string, available: string[]) {
  const target = norm(wanted);
  if (!target) return 0;
  if (available.includes(target)) return 1;
  if (
    available.some(
      (value) => value.includes(target) || target.includes(value),
    )
  ) {
    return 0.72;
  }
  const words = target.split(" ");
  return available.some((value) => words.every((word) => value.includes(word)))
    ? 0.55
    : 0;
}

function rating(tags: Record<string, unknown>) {
  const raw = list(tags.RATING ?? tags.rating)[0];
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value <= 0.05) return Math.min(5, value * 100);
  if (value <= 1) return value * 5;
  return Math.min(5, value);
}

function listeningSignal(
  artist: string,
  album: string,
  listening?: ListeningProfile,
) {
  const key = norm(artist) + "|" + norm(album);
  const frequent = listening?.frequent ?? [];
  const item = frequent.find(
    (entry) =>
      norm(String(entry.artist ?? "")) +
        "|" +
        norm(String(entry.name ?? entry.album ?? "")) ===
      key,
  );
  if (!item) return { score: 0, reason: "" };
  const plays = Number(item.playCount ?? 0);
  const played = Date.parse(String(item.played ?? ""));
  const ageDays = Number.isFinite(played)
    ? Math.max(0, (Date.now() - played) / 86_400_000)
    : 60;
  const score =
    Math.log1p(plays) * 8 +
    Math.min(18, ageDays * 0.35) -
    (ageDays < 14 ? 18 : 0);
  return {
    score,
    reason:
      ageDays >= 30
        ? "A former favorite not played recently"
        : "Previously played " + plays + " times",
  };
}

function matches(
  wanted: string[],
  available: string[],
  weight: number,
) {
  const found = wanted
    .map((value) => ({ value, quality: match(value, available) }))
    .filter((item) => item.quality > 0);
  return {
    score: found.reduce((total, item) => total + item.quality * weight, 0),
    values: found.map((item) => item.value),
  };
}

export function scoreCandidate(input: {
  definition: PlaylistDefinition;
  artist: string;
  album: string;
  title: string;
  year: number;
  tags: Record<string, unknown>;
  profile: Record<string, unknown>;
  listening?: ListeningProfile;
}) {
  const { definition, artist, album, title, year, tags, profile, listening } =
    input;
  const available = terms(profile);
  const direction = matches(
    [...definition.config.tasteLanes, ...definition.config.genres],
    available,
    28,
  );
  const moods = matches(definition.config.moods, available, 20);
  const contexts = matches(definition.config.contexts, available, 14);
  const found = [...direction.values, ...moods.values, ...contexts.values];
  const exclusions = definition.config.exclusions.map(norm);
  const text = norm(artist + " " + album + " " + title);
  const blocked = exclusions.some(
    (value) =>
      text.includes(value) ||
      available.some((term) => term.includes(value) || value.includes(term)),
  );
  const ratingValue = rating(tags);
  const listeningValue = listeningSignal(artist, album, listening);
  let score = 20 + direction.score + moods.score + contexts.score;
  let eligible = !blocked;

  if (definition.category === "discovery") {
    score += Math.max(0, Math.min(18, (year - (new Date().getFullYear() - 4)) * 4));
  }
  if (definition.category === "depth") score += available.length * 0.25;
  if (definition.category === "rediscovery") {
    score = ratingValue * 8 + listeningValue.score;
    eligible = eligible && score >= 12;
  }

  const expected =
    definition.config.tasteLanes.length +
    definition.config.genres.length +
    definition.config.moods.length +
    definition.config.contexts.length;
  if (expected && !found.length) eligible = false;

  const reason =
    definition.category === "rediscovery"
      ? listeningValue.reason ||
        (ratingValue ? "Highly rated in your library" : "Rediscovery candidate")
      : found.length
        ? "Matches " + found.slice(0, 4).join(", ")
        : "Fits " + definition.category.replaceAll("_", " ") + " intent";

  return { score, reason, eligible };
}

export function desiredTerms(config: PlaylistConfig) {
  return [
    ...config.tasteLanes,
    ...config.genres,
    ...config.moods,
    ...config.contexts,
  ];
}
