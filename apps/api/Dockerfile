FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @find-my-path/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @find-my-path/api build

# The build is a single bundled file: no node_modules needed at runtime.
FROM node:22-slim
WORKDIR /app
COPY --from=build /repo/apps/api/dist/server.js ./server.js
COPY data/climbs/ile-de-france.json ./climbs.json
ENV NODE_ENV=production PORT=8787 CLIMBS_FILE=/app/climbs.json
USER node
EXPOSE 8787
CMD ["node", "server.js"]
