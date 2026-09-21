import { z } from "zod";
const schema = z.object({
  MUSIC_ROOT: z.string().default("/music"), CURATOR_DB_PATH: z.string().optional(), DATABASE_PATH: z.string().optional(),
  LIDARR_URL: z.string().url().default("http://lidarr:8686"), LIDARR_API_KEY: z.string().default(""),
  CURATOR_AI_API_KEY: z.string().default(""), CURATOR_AI_BASE_URL: z.string().url().default("http://inference-api.inference.svc.cluster.local:8080/v1"), CURATOR_AI_MODEL: z.string().default("curator"),
  PROWLARR_URL: z.string().url().default("http://prowlarr:9696"), PROWLARR_API_KEY: z.string().default(""),
  QBITTORRENT_URL: z.string().url().default("http://qbittorrent:8080"), QBITTORRENT_USERNAME: z.string().default(""), QBITTORRENT_PASSWORD: z.string().default(""), QBITTORRENT_CATEGORY: z.string().default("music"),
  NAVIDROME_URL: z.string().url().default("http://navidrome:4533"), NAVIDROME_PUBLIC_URL: z.string().url().default("http://localhost:4533"), NAVIDROME_USERNAME: z.string().default(""), NAVIDROME_PASSWORD: z.string().default(""),
  CURATOR_SESSION_SECRET: z.string().min(32).default("build-only-session-secret-change-me-0000000000000000"),
  CURATOR_CREDENTIAL_KEY: z.string().min(32).default("build-only-credential-key-change-me-0000000000000000"),
  CURATOR_AUTOSTART: z.enum(["true", "false"]).default("true"),
});
const parsed = schema.parse(process.env);
export const config = { ...parsed, DATABASE_PATH: parsed.CURATOR_DB_PATH ?? parsed.DATABASE_PATH ?? "/app/data/curator.sqlite" };
export const versions = { taxonomy: 5, prompt: 6, normalization: 11, artwork: 11, identity: 9, providers: 5, categorizationSchema: 2, categorizationPrompt: 7, audioAnalysis: 3 };
