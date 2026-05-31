# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
RUN useradd -m -u 1000 harness
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER harness
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "server.js"]
