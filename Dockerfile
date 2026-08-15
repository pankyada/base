# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile --filter . --ignore-workspace
COPY src ./src
COPY profiles ./profiles
RUN pnpm build

# ---- runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable && useradd -m harness
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --filter . --ignore-workspace && pnpm store prune
COPY --from=build /app/dist ./dist
COPY profiles ./profiles
USER harness
ENV HARNESS_PORT=7337
EXPOSE 7337
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "require('http').get('http://localhost:7337/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/src/server/index.js"]
