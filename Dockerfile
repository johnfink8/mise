# syntax=docker/dockerfile:1.7
# ---------- deps: install node_modules with the lockfile ----------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder: compile Next standalone bundle ----------
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- migrate: one-shot image used by docker-compose to apply migrations ----------
FROM node:22-slim AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY drizzle ./drizzle
COPY scripts ./scripts
CMD ["npm", "run", "db:migrate"]

# ---------- runner: minimal runtime ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Cache Transformers.js model downloads to a known dir (mount as a volume to
# survive container restarts and avoid re-downloading bge-small-en-v1.5).
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --shell /bin/sh nextjs

# Standalone output (next.config.ts has `output: 'standalone'`) ships only the
# files server.js needs, with a pruned node_modules. Static assets and the
# `public` directory must be copied separately.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Native deps for @huggingface/transformers — onnxruntime-node ships
# `libonnxruntime.so.1` in its package, and the standalone tracer doesn't
# include it because we list transformers in `serverExternalPackages`. Bring
# the whole package tree across so the dynamic loader can find the native
# binary at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@huggingface ./node_modules/@huggingface
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/onnxruntime-node ./node_modules/onnxruntime-node
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/onnxruntime-common ./node_modules/onnxruntime-common
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp

# Files our server reads from disk at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/prompts ./prompts

RUN mkdir -p /app/.cache/huggingface && chown -R nextjs:nodejs /app/.cache

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
