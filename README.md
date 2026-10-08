# Music Curator

Music Curator is a self-hosted Next.js application that scans, normalizes, and enriches a Lidarr/Navidrome music library. It keeps factual identity evidence separate from semantic enrichment and writes portable metadata and artwork back to the library.

## Runtime

The container runs the authenticated web application and its isolated background worker. It requires a writable SQLite volume at /app/data and a writable music library at /music.

Copy .env.example to a private runtime environment and supply the required credentials. Never commit .env, SQLite databases, library files, or provider credentials.

Curator uses one local inference model for enrichment, categorization, identity resolution, editorial discovery, and artwork research. Configure it with `CURATOR_AI_API_KEY`, `CURATOR_AI_BASE_URL`, and `CURATOR_AI_MODEL`. Web research runs through Curator's bounded `web_search` and `open_url` tool loop.

## Build

    npm ci
    npx tsc --noEmit
    npm run build
    docker build -t music-curator .

Published images are available from ghcr.io/busykoala/curator. Deployment configuration lives in the separate busykoala/server infrastructure repository.

## Data boundaries

- SQLite stores operational state, provider evidence, jobs, and settings.
- Music files and sidecar artwork remain the durable enriched library.
- Provider credentials are server-only.
- The local inference endpoint receives structured metadata evidence, never audio files.

## Playlists

Create Discovery, Deep Dive, Mood & Occasion, Progressive Journey, or Rediscovery playlists from the playlist studio. Personal Deep Dive and Rediscovery playlists accept a genre or style and remain editable; automatic listening-based defaults are managed separately.

AI Chat playlists use a conversation and a song count (1–100). The AI explores the available library with overview, filtered search, and track-inspection tools, and can research public musical references. Conversations and exact ordered selections persist across visits. Save the first draft to Navidrome; subsequent chat corrections update that playlist immediately. If synchronization fails, the draft remains available for retry. Chat playlists do not regenerate their selection nightly.

Selections are checked against inspected library IDs, deduplicated by recording, and bounded to the requested count. Insufficient matches remain visible as a shortage. Metadata and web results have bounded context budgets, and invalid selections receive one repair attempt before the previous draft is left intact.

Run the live suggestion/correction evaluation against a read-only cluster metadata export:

    PLAYLIST_EVAL_KUBECONFIG=../server/kubeconfig npm run evaluate:playlist-chat

The evaluator retrieves the AI key into memory and never writes credentials to its report. Override the public inference endpoint with `PLAYLIST_EVAL_AI_URL` if needed. Alternatively, `PLAYLIST_EVAL_INPUT` may point to a private directory containing `credentials.json` (`apiKey`, `baseURL`, `model`) and `library.json` (rows with `fileId`, `artist`, `album`, `tagsJson`, `profileJson`). Reports go to `delivery/playlist-chat-evaluation`, configurable with `PLAYLIST_EVAL_OUTPUT`. The fixed cases check song counts, inspected identities, genre/vocal/instrument/date constraints, retained positions, exclusions, and requested ordering. They do not measure audio quality or subjective musical taste.
