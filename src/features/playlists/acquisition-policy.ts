export const acquisitionPolicy = {
  retryHours: 24,
  maxSearches: 3,
  sourceLessHours: 96,
  stalledHours: 72,
  hardLimitHours: 14 * 24,
  cooldownDays: 90,
} as const;

export type AcquisitionSnapshot = {
  ageHours: number;
  idleHours: number;
  sinceSearchHours: number;
  hasQueueItem: boolean;
  progressed: boolean;
  searches: number;
};

export type AcquisitionDecision = {
  action: "wait" | "retry" | "abandon";
  reason: string;
};

export function decideAcquisition(value: AcquisitionSnapshot): AcquisitionDecision {
  if (value.ageHours >= acquisitionPolicy.hardLimitHours) {
    return { action: "abandon", reason: "Download exceeded the 14-day acquisition ceiling" };
  }
  if (value.hasQueueItem) {
    if (value.progressed) return { action: "wait", reason: "Download made progress" };
    if (value.idleHours >= acquisitionPolicy.stalledHours) {
      return { action: "abandon", reason: "Download made no byte progress for 72 hours" };
    }
    return { action: "wait", reason: "Waiting for the active Lidarr download" };
  }
  if (value.searches < acquisitionPolicy.maxSearches && value.sinceSearchHours >= acquisitionPolicy.retryHours) {
    return { action: "retry", reason: "No download was found; retrying the album search" };
  }
  if (value.ageHours >= acquisitionPolicy.sourceLessHours && value.searches >= acquisitionPolicy.maxSearches) {
    return { action: "abandon", reason: "No usable download was found after three searches" };
  }
  return { action: "wait", reason: "Waiting for Lidarr to find a usable release" };
}
