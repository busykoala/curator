import { processCategorizationBatch } from "../src/features/categorization/process";

const albumBatch = 16;
let stopping = false;
let idleRounds = 0;
let albums = 0;
let tracks = 0;
let classified = 0;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  console.log(JSON.stringify({ event: "accelerator_started", lanes: 1, albumBatch }));
  while (!stopping) {
    const result = await processCategorizationBatch(albumBatch, (progress) => {
      console.log(JSON.stringify({ event: "progress", ...progress }));
    });
    albums += result.albums;
    tracks += result.tracks;
    classified += result.classified;
    console.log(JSON.stringify({
      event: "batch_complete",
      albums,
      tracks,
      classified,
      partial: result.partial,
      remaining: result.remaining,
    }));
    if (result.remaining === 0) break;
    if (result.albums === 0) {
      idleRounds += 1;
      if (idleRounds >= 12) break;
      await sleep(5_000);
    } else {
      idleRounds = 0;
    }
  }
  console.log(JSON.stringify({ event: "accelerator_stopped", albums, tracks, classified }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "accelerator_failed", error: String(error) }));
  process.exitCode = 1;
});
