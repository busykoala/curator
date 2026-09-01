import type {
  PlaylistCandidate,
  PlaylistConfig,
} from "./types";

const levels = ["very_low", "low", "medium", "high", "very_high"];

export function energyValue(item: PlaylistCandidate) {
  const index = levels.indexOf(String(item.profile.energy ?? "medium"));
  const semantic = index < 0 ? 0.5 : index / (levels.length - 1);
  const bpm = Number(item.profile.bpm ?? 0);
  const tempo = bpm > 0 ? Math.max(0, Math.min(1, (bpm - 60) / 120)) : semantic;
  return semantic * 0.72 + tempo * 0.28;
}

export function energyTarget(
  curve: PlaylistConfig["energyCurve"],
  position: number,
  total: number,
) {
  const x = total <= 1 ? 0 : position / (total - 1);
  if (curve === "ascent") return 0.12 + x * 0.82;
  if (curve === "descent") return 0.92 - x * 0.72;
  if (curve === "wave") return 0.18 + Math.sin(x * Math.PI) * 0.78;
  if (curve === "slow_burn") {
    if (x < 0.3) return 0.16 + x * 0.18;
    if (x < 0.82) return 0.21 + ((x - 0.3) / 0.52) * 0.75;
    return 0.96 - ((x - 0.82) / 0.18) * 0.42;
  }
  return 0.5;
}

export function sequenceJourney(
  items: PlaylistCandidate[],
  config: PlaylistConfig,
) {
  const pool = [...items];
  const result: PlaylistCandidate[] = [];
  const target = Math.min(config.targetTracks, pool.length);
  const retainTarget = Math.min(
    Math.round(target * (1 - config.rotationPercent / 100)),
    pool.filter((item) => item.retained).length,
  );
  while (pool.length && result.length < target) {
    const position = result.length;
    const desired = energyTarget(config.energyCurve, position, target);
    const previous = result.at(-1);
    const retainedChosen = result.filter((item) => item.retained).length;
    const retainedNeeded = retainTarget - retainedChosen;
    const slotsLeft = target - result.length;
    const eligible =
      retainedNeeded > 0 && slotsLeft <= retainedNeeded
        ? pool.filter((item) => item.retained)
        : pool;
    eligible.sort(
      (left, right) =>
        transitionCost(left, desired, previous) -
        transitionCost(right, desired, previous),
    );
    const selected = eligible[0];
    pool.splice(pool.indexOf(selected), 1);
    result.push(selected);
  }
  return result;
}

function transitionCost(
  item: PlaylistCandidate,
  desired: number,
  previous?: PlaylistCandidate,
) {
  const bpm = Number(item.profile.bpm ?? 0);
  const previousBpm = Number(previous?.profile.bpm ?? 0);
  const bpmCost =
    previousBpm && bpm ? Math.min(1, Math.abs(bpm - previousBpm) / 55) : 0.2;
  const currentKey = String(item.profile.musicalKey ?? "");
  const previousKey = String(previous?.profile.musicalKey ?? "");
  const keyCost =
    currentKey && previousKey && currentKey !== previousKey ? 0.16 : 0;
  return (
    Math.abs(energyValue(item) - desired) * 2.4 +
    bpmCost * 0.42 +
    keyCost -
    item.score * 0.006
  );
}
