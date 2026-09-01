import { stateGet, stateSet } from "@/features/db/client";
import { ensureAutomaticPlaylists } from "./automatic";
import { refreshListeningClusters } from "./clusters";
import { researchDiscovery, refreshDiscoveryStates } from "./discovery";
import { generateEnabledPlaylists } from "./generate";
import { refreshNextRunTimes } from "./repository";

function local() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: get("year") + "-" + get("month") + "-" + get("day"),
    weekday: get("weekday"),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export async function runPlaylistSchedule() {
  const now = local();
  await refreshDiscoveryStates();
  await ensureAutomaticPlaylists().catch((error) =>
    stateSet("playlist_error", String(error)),
  );
  refreshNextRunTimes();

  if (
    ["Tue", "Fri"].includes(now.weekday) &&
    now.minutes >= 210 &&
    now.minutes < 240 &&
    stateGet("playlist_research_date") !== now.date
  ) {
    stateSet("playlist_research_date", now.date);
    stateSet("playlist_phase", "research");
    try {
      stateSet(
        "playlist_research_result",
        JSON.stringify(await researchDiscovery()),
      );
    } catch (error) {
      stateSet("playlist_error", String(error));
    }
  }

  if (
    now.minutes >= 270 &&
    now.minutes < 300 &&
    stateGet("playlist_run_date") !== now.date
  ) {
    stateSet("playlist_run_date", now.date);
    stateSet("playlist_phase", "clusters");
    await refreshListeningClusters().catch((error) =>
      stateSet("playlist_error", String(error)),
    );
    await ensureAutomaticPlaylists().catch((error) =>
      stateSet("playlist_error", String(error)),
    );
    stateSet("playlist_phase", "generate");
    const results = await generateEnabledPlaylists();
    stateSet(
      "playlist_run_result",
      JSON.stringify(
        results.map((result) =>
          "error" in result
            ? result
            : "waitingForAcquisition" in result
              ? result
            : {
                playlistId: result.definition.id,
                tracks: result.items.length,
              },
        ),
      ),
    );
  }

  stateSet("playlist_phase", "idle");
}
