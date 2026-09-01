# Music Curator

Music Curator is a self-hosted Next.js application that scans, normalizes, and enriches a Lidarr/Navidrome music library. It keeps factual identity evidence separate from semantic enrichment and writes portable metadata and artwork back to the library.

## Runtime

The container runs the authenticated web application and its isolated background worker. It requires a writable SQLite volume at /app/data and a writable music library at /music.

Copy .env.example to a private runtime environment and supply the required credentials. Never commit .env, SQLite databases, library files, or provider credentials.

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
- OpenAI receives structured metadata evidence, never audio files.
