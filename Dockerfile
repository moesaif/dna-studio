FROM node:20-alpine AS base

# Install dependencies for Playwright and Prisma
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    openssl

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ---- Build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

# ---- App Production ----
FROM base AS app
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core

# The Prisma CLI runs `migrate deploy` at container start (docker/entrypoint.sh),
# so its dependencies have to be present at runtime. Since Prisma 6, the CLI
# pulls in @prisma/config, which brings the packages below with it — without
# them the container starts and immediately dies with
# "Cannot find module 'effect'".
#
# This list is the transitive closure of the `prisma` package. If a future
# Prisma upgrade changes it, the `compose` job in .github/workflows/ci.yml
# fails: it boots the real image and waits for the healthcheck.
COPY --from=builder /app/node_modules/@standard-schema ./node_modules/@standard-schema
COPY --from=builder /app/node_modules/c12 ./node_modules/c12
COPY --from=builder /app/node_modules/chokidar ./node_modules/chokidar
COPY --from=builder /app/node_modules/citty ./node_modules/citty
COPY --from=builder /app/node_modules/confbox ./node_modules/confbox
COPY --from=builder /app/node_modules/consola ./node_modules/consola
COPY --from=builder /app/node_modules/deepmerge-ts ./node_modules/deepmerge-ts
COPY --from=builder /app/node_modules/defu ./node_modules/defu
COPY --from=builder /app/node_modules/destr ./node_modules/destr
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder /app/node_modules/effect ./node_modules/effect
COPY --from=builder /app/node_modules/empathic ./node_modules/empathic
COPY --from=builder /app/node_modules/exsolve ./node_modules/exsolve
COPY --from=builder /app/node_modules/fast-check ./node_modules/fast-check
COPY --from=builder /app/node_modules/giget ./node_modules/giget
COPY --from=builder /app/node_modules/jiti ./node_modules/jiti
COPY --from=builder /app/node_modules/node-fetch-native ./node_modules/node-fetch-native
COPY --from=builder /app/node_modules/nypm ./node_modules/nypm
COPY --from=builder /app/node_modules/ohash ./node_modules/ohash
COPY --from=builder /app/node_modules/pathe ./node_modules/pathe
COPY --from=builder /app/node_modules/perfect-debounce ./node_modules/perfect-debounce
COPY --from=builder /app/node_modules/pkg-types ./node_modules/pkg-types
COPY --from=builder /app/node_modules/pure-rand ./node_modules/pure-rand
COPY --from=builder /app/node_modules/rc9 ./node_modules/rc9
COPY --from=builder /app/node_modules/readdirp ./node_modules/readdirp
COPY --from=builder /app/node_modules/tinyexec ./node_modules/tinyexec
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./docker/entrypoint.sh

RUN chown -R nextjs:nodejs node_modules/@prisma node_modules/prisma

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Reports unhealthy — rather than a misleading "Up" — when the app cannot serve
# requests or cannot reach the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["/app/docker/entrypoint.sh"]
