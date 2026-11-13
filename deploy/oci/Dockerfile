# Manmade services (evidence, indexer, relayer) for the OCI host. One image, three commands.
FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "./services/**" --filter "./packages/**" \
 && pnpm store prune
ENV HOST=0.0.0.0 NODE_ENV=production
