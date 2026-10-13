# Aura production image (Phase 8.5): Next.js standalone + signaling server.
# Build:  docker build -t aura .
# Run:    docker compose up (see docker-compose.yml)

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are inlined at build time — pass build args as needed.
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Next standalone server (serves the app on $PORT, default 3000)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Signaling server sources run directly (Node 24 type-stripping, no build)
COPY --from=builder /app/server ./server
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/node_modules/ws ./node_modules/ws
COPY --from=builder /app/node_modules/zod ./node_modules/zod
EXPOSE 3000 3100
CMD ["sh", "-c", "node server/signaling-server.ts & node server.js"]
