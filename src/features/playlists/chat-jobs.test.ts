import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { StructuredRequest } from "../ai/client";

test("durable chat jobs deduplicate retries, fence workers, and resume saved replies after interruption", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-chat-jobs-"));
  process.env.CURATOR_DB_PATH = join(directory, "test.sqlite");
  process.env.CURATOR_AI_API_KEY = "test-only";
  const { db } = await import("../db/client");
  const { aiClient } = await import("../ai/client");
  const { provisionUser } = await import("../auth/navidrome");
  const { createPlaylist } = await import("./repository");
  const { chatState, acquireChatLease, releaseChatLease } = await import("./chat-state");
  const { enqueuePlaylistMessage, claimChatJob, checkpointChatJob, heartbeatChatJob, latestChatJob } = await import("./chat-jobs");
  const { runNextChatJob } = await import("./chat-job-runner");
  const { sendPlaylistMessage } = await import("./chat");
  const database = db(), user = provisionUser({ token: "test", navidromeUserId: "one", username: "one", displayName: "One" });
  const original = aiClient.structured;
  let calls = 0;
  aiClient.structured = async <T>(request: StructuredRequest) => {
    calls++;
    await request.tools?.find(t => t.name === "set_requirements")?.execute({ genres: [], excludeGenres: [], instruments: [], artists: [], excludeArtists: [], vocal: "any", minYear: 0, maxYear: 0, minBpm: 0, maxBpm: 0 });
    await request.tools?.find(t => t.name === "inspect_tracks")?.execute({ fileIds: [1] });
    return { data: { name: "A mix", reply: "Here is your mix", guidance: "Calm", tracks: [{ fileId: 1, reason: "Fits" }] } as T, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  };
  database.prepare("INSERT INTO files(id,path,album_key,artist_name,album_name,format,inode,link_count,size,mtime_ms,tags_json,properties_json,artwork_json,status) VALUES (1,'/music/song.flac','one','Artist','Album','flac',1,1,1,1,'{\"title\":[\"Song\"]}','{}','{}','written')").run();
  try {
    const playlist = createPlaylist({ name: "Draft one", category: "chat", ownerUserId: user.id, config: { targetTracks: 1 } });
    const request = { requestId: randomUUID(), message: "A calm mix", targetTracks: 1, revision: 0 };
    const queued = enqueuePlaylistMessage(playlist.id, request);
    assert.equal(queued.job?.status, "queued"); assert.equal(calls, 0); assert.equal(queued.messages.length, 0);
    assert.equal(enqueuePlaylistMessage(playlist.id, request).job?.id, queued.job?.id);
    assert.throws(() => enqueuePlaylistMessage(playlist.id, { ...request, message: "Different" }), /already been used/);
    assert.throws(() => enqueuePlaylistMessage(playlist.id, { ...request, requestId: randomUUID() }), /already being updated/);
    assert.throws(() => acquireChatLease(playlist.id), /already being updated/);
    assert.equal(await runNextChatJob(), true);
    assert.equal(calls, 1); assert.equal(chatState(playlist.id).revision, 1); assert.equal(chatState(playlist.id).messages.length, 2);
    assert.equal(latestChatJob(playlist.id)?.status, "completed");
    assert.equal(enqueuePlaylistMessage(playlist.id, request).job?.id, request.requestId);
    assert.equal(await runNextChatJob(), false); assert.equal(calls, 1);
    assert.throws(() => enqueuePlaylistMessage(playlist.id, { ...request, requestId: randomUUID() }), /conversation has changed/);

    const second = createPlaylist({ name: "Draft two", category: "chat", ownerUserId: user.id, config: { targetTracks: 1 } });
    const recoveryRequest = { ...request, requestId: randomUUID() };
    enqueuePlaylistMessage(second.id, recoveryRequest);
    const interrupted = claimChatJob()!;
    acquireChatLease(second.id, interrupted.id, interrupted.lease);
    await sendPlaylistMessage(second.id, recoveryRequest, { lease: interrupted.lease, stored: () => checkpointChatJob(interrupted.id, interrupted.lease, chatState(second.id).revision) });
    assert.equal(calls, 2); assert.equal(latestChatJob(second.id)?.phase, "sync");
    // Simulate the worker disappearing between the saved reply and job completion.
    database.prepare("UPDATE playlist_chat_jobs SET lease_until=1 WHERE id=?").run(interrupted.id);
    assert.equal(heartbeatChatJob(interrupted.id, interrupted.lease), false);
    assert.equal(await runNextChatJob(), true);
    assert.equal(calls, 2); assert.equal(chatState(second.id).revision, 1); assert.equal(chatState(second.id).messages.length, 2);
    assert.equal(latestChatJob(second.id)?.status, "completed");
    assert.equal(latestChatJob(second.id)?.attempts, 2);
    assert.throws(() => checkpointChatJob(interrupted.id, interrupted.lease, 2), /expired/);
    releaseChatLease(second.id, interrupted.lease);

    const failed = createPlaylist({ name: "Draft failing", category: "chat", ownerUserId: user.id, config: { targetTracks: 1 } });
    aiClient.structured = async () => { throw new Error("Inference unavailable"); };
    enqueuePlaylistMessage(failed.id, { ...request, requestId: randomUUID() });
    await runNextChatJob();
    assert.equal(latestChatJob(failed.id)?.status, "failed"); assert.match(latestChatJob(failed.id)!.error, /unavailable/);
    assert.equal(chatState(failed.id).revision, 0);
    assert.ok(acquireChatLease(failed.id));
  } finally {
    aiClient.structured = original; database.close(); delete (globalThis as { curatorDb?: unknown }).curatorDb; rmSync(directory, { recursive: true, force: true });
  }
});
