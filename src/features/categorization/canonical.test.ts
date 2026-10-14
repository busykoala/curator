import assert from "node:assert/strict";
import test from "node:test";
import { controlledValues } from "./canonical";
import { semanticBatchJsonSchema } from "./schema";

test("dembow grooves survive semantic normalization instead of creating a sparse profile", () => {
  assert.deepEqual(controlledValues("groove", ["dembow", "dembow_rhythm"]), ["dembow"]);
  assert.deepEqual(controlledValues("groove", ["unrecognized_groove"]), []);
  assert.deepEqual(controlledValues("groove", ["syncopated", "dembow"]), ["syncopated", "dembow"]);
});

test("structured generation constrains controlled terms while keeping musical styles extensible", () => {
  const fields = semanticBatchJsonSchema.properties.tracks.items.properties.profile.properties;
  assert.ok(fields.mood.items.enum?.includes("serene"));
  assert.ok(!fields.mood.items.enum?.includes("relaxed"));
  assert.ok(fields.groove.items.enum?.includes("dembow"));
  assert.equal(fields.style.items.enum, undefined);
});
