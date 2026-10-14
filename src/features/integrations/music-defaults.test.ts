import assert from "node:assert/strict";
import test from "node:test";
import { metadataProfileForReleases, type MetadataProfile } from "./music-defaults";

const standard: MetadataProfile = { id: 1, primaryAlbumTypes: [{ albumType: { name: "Album" }, allowed: true }, { albumType: { name: "Single" }, allowed: false }], secondaryAlbumTypes: [{ albumType: { name: "Studio" }, allowed: true }] };
const singles: MetadataProfile = { ...standard, id: 3, primaryAlbumTypes: standard.primaryAlbumTypes.map(type => ({ ...type, allowed: true })) };

test("a requested single uses an enabled profile while albums retain the configured default", () => {
  assert.equal(metadataProfileForReleases([standard, singles], 1, [{ albumType: "Single", secondaryTypes: [] }]), 3);
  assert.equal(metadataProfileForReleases([standard, singles], 1, [{ albumType: "Album" }]), 1);
  assert.equal(metadataProfileForReleases([standard, singles], 1, [{ albumType: "Album" }, { albumType: "Single" }]), 3);
});

test("disabled release types and secondary types are not silently accepted", () => {
  assert.throws(() => metadataProfileForReleases([standard], 1, [{ albumType: "Single" }]), /release type is not enabled/);
  assert.throws(() => metadataProfileForReleases([standard, singles], 1, [{ albumType: "Album", secondaryTypes: [{ name: "Live" }] }]), /release type is not enabled/);
});
