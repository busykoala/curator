import { claimChatJob, checkpointChatJob, finishChatJob, heartbeatChatJob } from "./chat-jobs";
import { acquireChatLease, chatState, releaseChatLease } from "./chat-state";
import { sendPlaylistMessage } from "./chat";
import { generatePlaylist } from "./generate";

export async function runNextChatJob() {
  const job = claimChatJob();
  if (!job) return false;
  const timer = setInterval(() => heartbeatChatJob(job.id, job.lease), 10_000);
  try {
    acquireChatLease(job.playlistId, job.id, job.lease);
    let result: { synced: boolean; syncError: string };
    if (job.phase === "sync") {
      if (chatState(job.playlistId).revision !== job.resultRevision) throw new Error("This conversation has changed. Please retry your message.");
      result = { synced: false, syncError: "" };
      if (job.syncRequired) {
        try { await generatePlaylist(job.playlistId, false, job.lease); result.synced = true; }
        catch (error) { result.syncError = error instanceof Error ? error.message : String(error); }
      }
    } else {
      result = await sendPlaylistMessage(job.playlistId, { message: job.message, targetTracks: job.targetTracks, revision: job.revision }, {
        lease: job.lease, stored: () => checkpointChatJob(job.id, job.lease, chatState(job.playlistId).revision),
      });
    }
    finishChatJob(job.id, job.lease, result);
    console.log(JSON.stringify({ event: "playlist_chat_job_complete", jobId: job.id, playlistId: job.playlistId, synced: result.synced, syncError: Boolean(result.syncError) }));
  } catch (error) {
    finishChatJob(job.id, job.lease, { error: error instanceof Error ? error.message : String(error) });
    console.error(JSON.stringify({ event: "playlist_chat_job_failed", jobId: job.id, playlistId: job.playlistId, error: error instanceof Error ? error.message : String(error) }));
  } finally {
    clearInterval(timer);
    releaseChatLease(job.playlistId, job.lease);
  }
  return true;
}
