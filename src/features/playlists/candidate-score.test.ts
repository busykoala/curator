import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, type ListeningProfile } from "./candidate-score";
import { defaultConfig, type PlaylistDefinition } from "./types";

function candidate(
  days: number,
  listening: ListeningProfile,
  tags: Record<string, unknown> = {},
) {
  const definition: PlaylistDefinition = {
    id: 1,
    name: "Forgotten jazz",
    category: "rediscovery",
    enabled: false,
    intent: "",
    config: {
      ...defaultConfig("rediscovery"),
      tasteLanes: ["jazz"],
      noveltyDays: days,
    },
    ownerUserId: 1,
    ownerDisplayName: "One",
    ownerTokenStatus: "active",
    navidromePlaylistId: null,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: "",
    updatedAt: "",
  };
  return scoreCandidate({
    definition,
    artist: "Artist",
    album: "Album",
    title: "Song",
    year: 1994,
    tags,
    profile: { genre: ["jazz"] },
    listening,
  });
}
const played = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

test("rediscovery respects the chosen inactivity period", () => {
  const listening = {
    frequent: [
      { artist: "Artist", name: "Album", playCount: 10, played: played(45) },
    ],
  };
  assert.equal(candidate(30, listening).eligible, true);
  assert.equal(candidate(60, listening).eligible, false);
});

test("recent songs keep an album out even when its most-played song is older", () => {
  const listening = {
    frequent: [
      { artist: "Artist", name: "Album", playCount: 20, played: played(90) },
      { artist: "Artist", name: "Album", playCount: 1, played: played(2) },
    ],
  };
  assert.equal(candidate(30, listening).eligible, false);
});

test("unplayed starred and highly rated favorites remain eligible; unrecognized songs do not", () => {
  assert.equal(
    candidate(365, { starred: [{ artist: "Artist", album: "Album" }] })
      .eligible,
    true,
  );
  assert.equal(candidate(365, {}, { RATING: ["5"] }).eligible, true);
  assert.equal(candidate(30, {}).eligible, false);
  assert.equal(
    candidate(30, {
      frequent: [{ artist: "Artist", name: "Album", playCount: 0, played: "" }],
    }).eligible,
    false,
  );
});

test("high ratings and stars do not bypass the recent-play boundary", () => {
  assert.equal(
    candidate(
      30,
      {
        frequent: [
          { artist: "Artist", name: "Album", playCount: 50, played: played(3) },
        ],
        starred: [{ artist: "Artist", album: "Album" }],
      },
      { RATING: ["5"] },
    ).eligible,
    false,
  );
});
