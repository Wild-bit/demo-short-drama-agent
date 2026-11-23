FROM node:24-bookworm-slim
RUN npm install --global pnpm@11.28.10
WORKDIR /app/web
COPY web/package.json web/pnpm-workspace.yaml web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/index.html web/tsconfig.json web/vite.config.ts ./
COPY web/src ./src
COPY web/public ./public
COPY src/domain /app/src/domain
EXPOSE 5173
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
