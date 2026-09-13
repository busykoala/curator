FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM build AS production-deps
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 LANG=C.UTF-8 LC_ALL=C.UTF-8
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends flac ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/.workers ./.workers
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /app/data /app/.next/cache && chmod -R a+rwX /app/data /app/.next/cache
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
