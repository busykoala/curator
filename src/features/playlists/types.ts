import { z } from "zod";

export const playlistCategories=["discovery","depth","mood","journey","rediscovery"] as const;
export const playlistCategorySchema=z.enum(playlistCategories);
export type PlaylistCategory=z.infer<typeof playlistCategorySchema>;
export const playlistConfigSchema=z.object({
  tasteLanes:z.array(z.string().trim().min(1).max(80)).max(12).default([]), genres:z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  moods:z.array(z.string().trim().min(1).max(80)).max(12).default([]), contexts:z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  exclusions:z.array(z.string().trim().min(1).max(120)).max(30).default([]), sourceDomains:z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  targetTracks:z.number().int().min(8).max(100).default(30), rotationPercent:z.number().int().min(0).max(100).default(30),
  maxTracksPerArtist:z.number().int().min(1).max(8).default(2), maxTracksPerAlbum:z.number().int().min(1).max(5).default(1),
  energyCurve:z.enum(["steady","ascent","slow_burn","wave","descent"]).default("steady"), externalDiscovery:z.boolean().default(false), noveltyDays:z.number().int().min(7).max(365).default(30),
});
export type PlaylistConfig=z.infer<typeof playlistConfigSchema>;
export type PlaylistDefinition={id:number;name:string;category:PlaylistCategory;enabled:boolean;intent:string;config:PlaylistConfig;navidromePlaylistId:string|null;lastRunAt:string|null;nextRunAt:string|null;createdAt:string;updatedAt:string};
export type PlaylistCandidate={fileId:number;title:string;artist:string;album:string;year:number;profile:Record<string,unknown>;score:number;reason:string;origin:"catalog"|"discovery";retained?:boolean};
export function defaultConfig(category:PlaylistCategory):PlaylistConfig{return playlistConfigSchema.parse({targetTracks:category==="journey"?12:category==="mood"?40:category==="discovery"?24:30,energyCurve:category==="journey"?"slow_burn":"steady",externalDiscovery:category==="discovery"})}
export const definitionInputSchema=z.object({name:z.string().trim().min(2).max(100),category:playlistCategorySchema,enabled:z.boolean().default(false),intent:z.string().trim().max(1000).default(""),config:playlistConfigSchema});
