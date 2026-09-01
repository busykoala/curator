import { existsSync, readFileSync } from "node:fs";

const baseUrl = process.env.CURATOR_URL ?? "http://localhost:4545";
const envFile = new URL("../../.env", import.meta.url);
const fileEnv = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const env = {
  ...Object.fromEntries(
    fileEnv
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1).replace(/^(['"])(.*)\1$/, "$2")];
    }),
  ),
  ...process.env,
};

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: baseUrl },
  body: JSON.stringify({ password: env.CURATOR_ADMIN_PASSWORD ?? "" }),
});
if (!login.ok) throw new Error(`Login failed (${login.status}): ${await login.text()}`);
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("Login succeeded without a session cookie");

const request = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie,
      origin: baseUrl,
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${text}`);
  return body;
};

const health = await fetch(`${baseUrl}/api/health`).then(async (response) => ({
  status: response.status,
  body: await response.json(),
}));
const readiness = await fetch(`${baseUrl}/api/readiness`).then(async (response) => ({
  status: response.status,
  body: await response.json(),
}));
let playlists = await request("/api/playlists");
const options = await request("/api/playlists/options");

const config = (overrides) => ({
  tasteLanes: [], genres: [], moods: [], contexts: [], exclusions: [], sourceDomains: [],
  targetTracks: 30, rotationPercent: 30, maxTracksPerArtist: 2, maxTracksPerAlbum: 1,
  energyCurve: "steady", externalDiscovery: false, noveltyDays: 30, ...overrides,
});
const desired = [
  {
    name: "Jazzy Mellow Chill",
    category: "mood",
    enabled: true,
    intent: "Warm, mellow and unhurried jazz-adjacent music for relaxed evenings. Avoid harsh or urgent tracks.",
    config: config({
      tasteLanes: ["jazz", "downtempo", "warm"],
      genres: ["jazz", "downtempo"],
      moods: ["warm", "serene", "reflective"],
      contexts: ["relaxation", "late_night"],
      exclusions: ["aggressive", "urgent", "harsh"],
      targetTracks: 30,
    }),
  },
  {
    name: "Melodic Techno Radar",
    category: "discovery",
    enabled: true,
    intent: "Melodic, atmospheric and emotionally focused techno with forward motion, avoiding generic festival EDM.",
    config: config({
      tasteLanes: ["melodic_techno", "techno", "ambient_techno"],
      genres: ["electronic", "techno"],
      moods: ["hypnotic", "euphoric"],
      contexts: ["club", "late_night"],
      exclusions: ["festival_edm"],
      targetTracks: 24,
      externalDiscovery: true,
    }),
  },
  {
    name: "Rock: Rise & Release",
    category: "journey",
    enabled: true,
    intent: "Begin restrained, build through energizing rock toward one clear triumphant peak, then settle into a confident release.",
    config: config({
      tasteLanes: ["rock", "alternative_rock", "hard_rock"],
      genres: ["rock", "alternative_rock", "hard_rock"],
      moods: ["uplifting", "triumphant", "energetic"],
      contexts: ["driving", "workout"],
      targetTracks: 18,
      energyCurve: "wave",
    }),
  },
  {
    name: "Blue Hour Jazz",
    category: "mood",
    enabled: true,
    intent: "Warm, intimate jazz and soul-jazz for dinner, conversation, or a quiet late evening.",
    config: config({ tasteLanes: ["jazz", "nu_jazz", "soul_jazz"], genres: ["jazz"], moods: ["warm", "reflective", "intimate"], contexts: ["late_night", "dinner", "headphones"], exclusions: ["aggressive", "urgent"], targetTracks: 30 }),
  },
  {
    name: "After Dark Motion",
    category: "mood",
    enabled: true,
    intent: "Hypnotic melodic electronic music for a night drive, steady movement, and focused after-dark energy.",
    config: config({ tasteLanes: ["melodic_techno", "techno", "downtempo"], genres: ["electronic"], moods: ["hypnotic", "euphoric", "mysterious"], contexts: ["late_night", "driving", "club"], exclusions: ["festival_edm"], targetTracks: 30 }),
  },
  {
    name: "Indie Morning Reset",
    category: "mood",
    enabled: true,
    intent: "Hopeful indie and alternative music that starts gently and gives the morning forward motion.",
    config: config({ tasteLanes: ["indie_rock", "indie_pop", "alternative_rock"], genres: ["rock", "alternative"], moods: ["hopeful", "uplifting", "playful"], contexts: ["morning", "daytime", "commute"], exclusions: ["somber", "aggressive"], targetTracks: 30 }),
  },
  {
    name: "Rock Momentum",
    category: "mood",
    enabled: true,
    intent: "Energizing rock for exercise, determined work, or driving, with force but without becoming chaotic.",
    config: config({ tasteLanes: ["rock", "hard_rock", "alternative_rock"], genres: ["rock"], moods: ["triumphant", "urgent", "euphoric"], contexts: ["workout", "driving"], exclusions: ["serene", "sleep"], targetTracks: 30 }),
  },
  {
    name: "Rainy Window",
    category: "mood",
    enabled: true,
    intent: "Dreamy, reflective and gently melancholic music for reading, rain, and an unhurried afternoon indoors.",
    config: config({ tasteLanes: ["downtempo", "indie_folk", "trip_hop"], genres: ["electronic", "folk", "rock"], moods: ["dreamy", "melancholic", "serene"], contexts: ["rainy_day", "relaxation", "reading"], exclusions: ["aggressive", "party"], targetTracks: 30 }),
  },
];

if (process.argv.includes("--seed")) {
  for (const definition of desired) {
    const existing = playlists.definitions.find((item) => item.name === definition.name);
    await request(existing ? `/api/playlists/${existing.id}` : "/api/playlists", {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify(definition),
    });
  }
  playlists = await request("/api/playlists");
}

const previews = [];
if (!process.argv.includes("--status")) {
for (const definition of playlists.definitions) {
  const body = await request(`/api/playlists/${definition.id}/run`, {
    method: "POST",
    body: JSON.stringify({ preview: true }),
  });
  const items = body.items ?? body.sequence ?? body.preview?.items ?? body.result?.items ?? [];
  const artists = items.map((item) => item.artist ?? item.file?.artist ?? item.track?.artist ?? "");
  const albums = items.map((item) => item.album ?? item.file?.album ?? item.track?.album ?? "");
  const titles = items.map((item) => item.title ?? item.file?.title ?? item.track?.title ?? "");
  const counts = (values) => Object.values(values.reduce((result, value) => {
    const key = String(value).toLocaleLowerCase();
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {}));
  const normalize = (value) => String(value).normalize("NFKD").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const profileTerms = (item) => new Set(Object.values(item.profile ?? {}).flatMap((value) => Array.isArray(value) ? value : [value]).map(normalize));
  const wanted = new Set([
    ...definition.config.tasteLanes,
    ...definition.config.genres,
    ...definition.config.moods,
    ...definition.config.contexts,
  ].map(normalize));
  const matched = items.filter((item) => [...wanted].some((term) => profileTerms(item).has(term))).length;
  const energyValue = (item) => {
    const semantic = ({ very_low: 0, low: 0.25, medium: 0.5, high: 0.75, very_high: 1 }[normalize(item.profile?.energy)] ?? 0.5);
    const bpm = Number(item.profile?.bpm ?? 0);
    const tempo = bpm > 0 ? Math.max(0, Math.min(1, (bpm - 60) / 120)) : semantic;
    return semantic * 0.72 + tempo * 0.28;
  };
  const targetEnergy = (index, length) => {
    const progress = length <= 1 ? 0 : index / (length - 1);
    if (definition.config.energyCurve === "ascent") return 0.12 + (0.82 * progress);
    if (definition.config.energyCurve === "descent") return 0.92 - (0.72 * progress);
    if (definition.config.energyCurve === "wave") return 0.18 + (0.78 * Math.sin(Math.PI * progress));
    if (definition.config.energyCurve === "slow_burn") return progress < 0.3 ? 0.2 + (0.12 * progress / 0.3) : progress < 0.82 ? 0.32 + (0.64 * (progress - 0.3) / 0.52) : 0.96 - (0.42 * (progress - 0.82) / 0.18);
    return 0.52;
  };
  const energies = items.map(energyValue);
  const curveError = energies.length ? energies.reduce((sum, value, index) => sum + Math.abs(value - targetEnergy(index, energies.length)), 0) / energies.length : null;
  const scores = items.map((item) => Number(item.score ?? 0));
  previews.push({
    id: definition.id,
    name: definition.name,
    category: definition.category,
    target: definition.config.targetTracks,
    tracks: items.length,
    retained: items.filter((item) => item.retained).length,
    uniqueArtists: new Set(artists.map((value) => value.toLocaleLowerCase())).size,
    maxArtistTracks: Math.max(0, ...counts(artists)),
    maxAlbumTracks: Math.max(0, ...counts(albums.map((album, index) => `${artists[index]}::${album}`))),
    duplicateRecordings: titles.filter((title, index) => {
      const key = `${artists[index]}::${title}`.toLocaleLowerCase();
      return titles.findIndex((candidate, candidateIndex) => `${artists[candidateIndex]}::${candidate}`.toLocaleLowerCase() === key) !== index;
    }).length,
    desiredTermFit: items.length ? Math.round((matched / items.length) * 100) : 0,
    scoreRange: scores.length ? [Math.min(...scores).toFixed(1), (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1), Math.max(...scores).toFixed(1)] : [],
    curveError: curveError === null ? null : Number(curveError.toFixed(3)),
    energySequence: definition.category === "journey" ? energies : undefined,
    bpmSequence: definition.category === "journey" ? items.map((item) => item.profile?.bpm ?? null) : undefined,
    sample: items.slice(0, 5).map((item) => `${item.artist} — ${item.title} (${item.album})`),
  });
}
}

const invalid = previews.filter((preview) =>
  preview.tracks !== preview.target ||
  preview.duplicateRecordings > 0 ||
  preview.maxArtistTracks > 2 ||
  preview.maxAlbumTracks > 1 ||
  (preview.category !== "rediscovery" && preview.desiredTermFit < 100) ||
  (preview.category === "journey" && (preview.curveError ?? 1) > 0.15)
);
if (invalid.length) {
  throw new Error(`Preview acceptance failed: ${invalid.map((item) => item.name).join(", ")}`);
}

let synchronized = [];
if (process.argv.includes("--sync")) {
  for (const definition of playlists.definitions.filter((item) => item.enabled)) {
    await request(`/api/playlists/${definition.id}/run`, {
      method: "POST",
      body: JSON.stringify({ preview: false }),
    });
  }
  playlists = await request("/api/playlists");
  synchronized = playlists.definitions.map((definition) => ({
    name: definition.name,
    navidromePlaylistId: definition.navidromePlaylistId,
    lastRunAt: definition.lastRunAt,
    lastRun: definition.runs[0]?.status ?? null,
    detail: definition.runs[0]?.detail_json ? JSON.parse(definition.runs[0].detail_json) : null,
  }));
}

console.log(JSON.stringify({
  health,
  readiness,
  definitions: playlists.definitions.map((definition) => ({ id: definition.id, name: definition.name, category: definition.category, enabled: definition.enabled, navidromePlaylistId: definition.navidromePlaylistId, nextRunAt: definition.nextRunAt })),
  schedule: playlists.schedule,
  previews,
  synchronized,
  optionCounts: Object.fromEntries(
    Object.entries(options).map(([key, value]) => [key, Array.isArray(value) ? value.length : value]),
  ),
}, null, 2));
