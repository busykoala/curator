import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "@/config";
import { db, stateGet, stateSet } from "@/features/db/client";
import { maintainSources } from "./prowlarr";

const directory = mkdtempSync(join(tmpdir(), "curator-source-health-"));
config.DATABASE_PATH = join(directory, "audit.sqlite");
after(() => {
  db().close();
  rmSync(directory, { recursive: true, force: true });
});

async function check({
  enabled,
  owned,
  healthy,
  apply = true,
  expected,
}: {
  enabled: boolean;
  owned: boolean;
  healthy: boolean;
  apply?: boolean;
  expected: boolean;
}) {
  db().exec("DELETE FROM state; DELETE FROM source_outcomes;");
  stateSet(
    "source_health_1",
    JSON.stringify({ failures: 2, successes: 1, disabledByCurator: owned }),
  );
  let source = { id: 1, name: "Test source", enable: enabled, priority: 50 },
    writes = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/indexer") return Response.json([source]);
    if (path === "/api/v1/indexer/test")
      return new Response(null, { status: healthy ? 200 : 400 });
    if (path === "/api/v1/indexer/1" && init?.method === "PUT") {
      source = JSON.parse(String(init.body));
      writes++;
      return Response.json(source);
    }
    throw Error("Unexpected source request " + path);
  };
  try {
    await maintainSources(apply);
    assert.equal(source.enable, expected);
    assert.equal(writes, apply ? 1 : 0);
    if (apply) assert.notEqual(source.priority, 50);
    const health = JSON.parse(stateGet("source_health_1"));
    assert.equal(health.disabledByCurator, apply ? !healthy && enabled : owned);
  } finally {
    globalThis.fetch = original;
  }
}

test("recovering a Curator-disabled source survives the daily priority update", async () => {
  await check({ enabled: false, owned: true, healthy: true, expected: true });
});
test("disabling a failing source survives the daily priority update", async () => {
  await check({ enabled: true, owned: false, healthy: false, expected: false });
});
test("a manually disabled healthy source remains disabled", async () => {
  await check({ enabled: false, owned: false, healthy: true, expected: false });
});
test("observation mode changes neither source settings nor recovery ownership", async () => {
  await check({
    enabled: false,
    owned: true,
    healthy: true,
    apply: false,
    expected: false,
  });
});
