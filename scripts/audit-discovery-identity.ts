import assert from "node:assert/strict";
import { resolveDiscoveryIdentity } from "../src/features/playlists/discovery";

const artist = "Answer Code Request";
const album = "Halo";
const releaseDate = "2026-06-26";
const releaseGroup = {
  id: "724eb338-8cd4-4222-b320-9e9467e303ed",
  title: album,
  "first-release-date": releaseDate,
  "artist-credit": [{ artist: { id: "artist-mbid", name: artist } }],
  score: 100,
};
const lidarrAlbum = {
  title: album,
  releaseDate: `${releaseDate}T00:00:00Z`,
  foreignAlbumId: releaseGroup.id,
  artist: { artistName: artist, foreignArtistId: "artist-mbid" },
};

async function main() {
const calls: string[] = [];
const resolved = await resolveDiscoveryIdentity(artist, album, releaseDate, {
  searchMusic: async (term) => {
    calls.push(term);
    return { albums: term.startsWith("lidarr:") ? [lidarrAlbum] : [] };
  },
  searchReleaseGroups: async () => ({ "release-groups": [releaseGroup] }),
});
assert.deepEqual(resolved, {
  artistId: "artist-mbid",
  albumId: releaseGroup.id,
});
assert.deepEqual(calls, [`${artist} ${album}`, `lidarr:${releaseGroup.id}`]);

const ambiguous = await resolveDiscoveryIdentity(artist, album, releaseDate, {
  searchMusic: async () => ({ albums: [] }),
  searchReleaseGroups: async () => ({
    "release-groups": [releaseGroup, { ...releaseGroup, id: "duplicate" }],
  }),
});
assert.equal(ambiguous, null);

const wrongYear = await resolveDiscoveryIdentity(artist, album, releaseDate, {
  searchMusic: async () => ({ albums: [] }),
  searchReleaseGroups: async () => ({
    "release-groups": [{ ...releaseGroup, "first-release-date": "2020-01-01" }],
  }),
});
assert.equal(wrongYear, null);

console.log(
  "Discovery identity audit passed: exact MusicBrainz fallback resolves text-search misses while ambiguity and year mismatches remain blocked.",
);
}

void main();
