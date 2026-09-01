import {
  Compass,
  History,
  MoonStar,
  Route,
  Telescope,
  type LucideIcon,
} from "lucide-react";

export type PlaylistDefinition = {
  id?: number;
  name: string;
  category: string;
  enabled: boolean;
  intent: string;
  config: Record<string, unknown>;
  navidromePlaylistId?: string | null;
  runs?: Array<{ status: string; createdAt?: string; finishedAt?: string }>;
};

export type PlaylistSuggestion = PlaylistDefinition;

export type PlaylistData = {
  definitions: PlaylistDefinition[];
  acquisitions: Array<Record<string, unknown>>;
  connection: { configured: boolean };
  schedule: { phase?: string; lastRun?: string; nextRun?: string };
};

export type PreviewItem = {
  fileId: number;
  title: string;
  artist: string;
  album: string;
  reason: string;
  profile?: Record<string, unknown>;
  retained?: boolean;
};

export type PlaylistPreview = {
  definition: PlaylistDefinition;
  items: PreviewItem[];
  detail?: Record<string, unknown>;
};

export type CategoryMeta = {
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
};

export const categoryOrder = [
  "discovery",
  "depth",
  "mood",
  "journey",
  "rediscovery",
] as const;

export const categoryMeta: Record<string, CategoryMeta> = {
  discovery: {
    label: "Discovery",
    shortLabel: "New music",
    description: "Editorially sourced releases close to your taste.",
    icon: Compass,
  },
  depth: {
    label: "Deep Dive",
    shortLabel: "Go deeper",
    description: "Deep cuts and connections inside your collection.",
    icon: Telescope,
  },
  mood: {
    label: "Mood & Occasion",
    shortLabel: "Set a mood",
    description: "Purposeful mixes for a place, feeling, or activity.",
    icon: MoonStar,
  },
  journey: {
    label: "Progressive Journey",
    shortLabel: "Build an arc",
    description: "A deliberate opening, rise, peak, release, and ending.",
    icon: Route,
  },
  rediscovery: {
    label: "Rediscovery",
    shortLabel: "Bring it back",
    description: "Favorites that have quietly fallen out of rotation.",
    icon: History,
  },
};

export function getMeta(category: string) {
  return categoryMeta[category] ?? categoryMeta.mood;
}

export function list(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}
