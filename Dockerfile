FROM node:24-bookworm-slim AS development

# 与当前锁文件记录的 pnpm 版本保持一致。
RUN npm install --global pnpm@11.28.10
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# MySQL 新增依赖尚未在宿主机完成锁定，允许安装时补齐锁文件。
RUN pnpm install --no-frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

EXPOSE 3000
CMD ["pnpm", "dev"]

FROM development AS build
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
