import { z } from "zod";
const schema = z.object({
  MUSIC_ROOT: z.string().default("/music"), DATABASE_PATH: z.string().default("/app/data/curator.sqlite"),
  LIDARR_URL: z.string().url().default("http://lidarr:8686"), LIDARR_API_KEY: z.string().default(""),
  CURATOR_AI_API_KEY: z.string().default(""), CURATOR_AI_BASE_URL: z.string().url().default("http://inference-api.inference.svc.cluster.local:8080/v1"), CURATOR_AI_MODEL: z.string().default("curator"),
  PROWLARR_URL: z.string().url().default("http://prowlarr:9696"), PROWLARR_API_KEY: z.string().default(""),
  QBITTORRENT_URL: z.string().url().default("http://qbittorrent:8080"), QBITTORRENT_USERNAME: z.string().default(""), QBITTORRENT_PASSWORD: z.string().default(""), QBITTORRENT_CATEGORY: z.string().default("music"),
  NAVIDROME_URL: z.string().url().default("http://navidrome:4533"), NAVIDROME_USERNAME: z.string().default(""), NAVIDROME_PASSWORD: z.string().default(""),
  CURATOR_ADMIN_PASSWORD: z.string().min(12).default("build-only-change-me"),
  CURATOR_SESSION_SECRET: z.string().min(32).default("build-only-session-secret-change-me-0000000000000000"),
  CURATOR_AUTOSTART: z.enum(["true", "false"]).default("true"),
});
export const config = schema.parse(process.env);
export const versions = { taxonomy: 5, prompt: 6, normalization: 11, artwork: 9, identity: 5, providers: 4, categorizationSchema: 2, categorizationPrompt: 7, audioAnalysis: 3 };
