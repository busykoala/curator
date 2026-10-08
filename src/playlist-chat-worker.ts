import { stateSet } from "@/features/db/client";
import { runNextChatJob } from "@/features/playlists/chat-job-runner";

let stopping = false;
const heartbeat = setInterval(() => stateSet("playlist_chat_heartbeat", new Date().toISOString()), 10_000);
stateSet("playlist_chat_heartbeat", new Date().toISOString());
console.log(JSON.stringify({ event: "worker_start", component: "playlist_chat", at: new Date().toISOString() }));
process.once("SIGTERM", () => { stopping = true; clearInterval(heartbeat); });
process.once("SIGINT", () => { stopping = true; clearInterval(heartbeat); });
while (!stopping) {
  try { if (await runNextChatJob()) continue; }
  catch (error) { console.error(JSON.stringify({ event: "playlist_chat_worker_error", error: String(error) })); }
  await new Promise(resolve => setTimeout(resolve, 1_000));
}
