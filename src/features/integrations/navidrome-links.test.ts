import test from "node:test";
import assert from "node:assert/strict";
import { nativeIdFromJellyfin } from "./navidrome-links";
test("Jellyfin wire IDs map to fixed-width native base62 IDs without losing leading zeros", () => {
  assert.equal(
    nativeIdFromJellyfin("00000000000000000000000000000001"),
    "0000000000000000000001",
  );
  assert.equal(
    nativeIdFromJellyfin("0000000000000000000000000000003d"),
    "000000000000000000000Z",
  );
  assert.equal(
    nativeIdFromJellyfin("0000000000000000000000000000003e"),
    "0000000000000000000010",
  );
  assert.equal(nativeIdFromJellyfin("legacy-playlist"), "legacy-playlist");
});
