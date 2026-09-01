"use client";

import type { PlaylistDefinition } from "./playlist-view-model";

type Curve = "slow_burn" | "ascent" | "wave" | "descent";

const shapes: Array<{
  value: Curve;
  label: string;
  detail: string;
  path: string;
}> = [
  {
    value: "slow_burn",
    label: "Slow burn",
    detail: "Hold back, peak late",
    path: "M4 29 C30 29 38 27 52 23 C73 17 88 5 103 5 C110 5 114 10 116 14",
  },
  {
    value: "ascent",
    label: "Steady rise",
    detail: "Build continuously",
    path: "M4 30 C33 28 55 21 76 14 C94 8 105 5 116 4",
  },
  {
    value: "wave",
    label: "Rise and release",
    detail: "One peak, then settle",
    path: "M4 29 C26 29 33 7 58 5 C82 4 91 27 116 28",
  },
  {
    value: "descent",
    label: "Gentle landing",
    detail: "Begin strong, ease down",
    path: "M4 5 C29 7 48 14 70 21 C90 27 105 29 116 30",
  },
];

export function EnergyShape({
  value,
  change,
}: {
  value: PlaylistDefinition["config"]["energyCurve"];
  change: (value: Curve) => void;
}) {
  return (
    <fieldset className="energy-picker energy-picker-v2">
      <legend>Energy shape</legend>
      {shapes.map((shape) => (
        <button
          type="button"
          className={value === shape.value ? "selected" : ""}
          key={shape.value}
          onClick={() => change(shape.value)}
        >
          <svg viewBox="0 0 120 36" aria-hidden="true">
            <path d={shape.path} />
          </svg>
          <span>
            <strong>{shape.label}</strong>
            <small>{shape.detail}</small>
          </span>
        </button>
      ))}
    </fieldset>
  );
}
