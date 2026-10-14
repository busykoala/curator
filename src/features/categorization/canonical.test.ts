import assert from "node:assert/strict";
import test from "node:test";
import { controlledValues } from "./canonical";

test("dembow grooves survive semantic normalization instead of creating a sparse profile", () => {
  assert.deepEqual(controlledValues("groove", ["dembow", "dembow_rhythm"]), ["dembow"]);
  assert.deepEqual(controlledValues("groove", ["unrecognized_groove"]), []);
  assert.deepEqual(controlledValues("groove", ["syncopated", "dembow"]), ["syncopated", "dembow"]);
});
