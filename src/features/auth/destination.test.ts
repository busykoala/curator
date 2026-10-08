import test from "node:test";
import assert from "node:assert/strict";
import { loginDestination } from "./destination";
test("sign-in returns to local pages and rejects external destinations", () => {
  assert.equal(
    loginDestination("/library?view=songs&q=jazz"),
    "/library?view=songs&q=jazz",
  );
  for (const destination of [
    undefined,
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/\nexample.com",
  ])
    assert.equal(loginDestination(destination), "/home");
});
