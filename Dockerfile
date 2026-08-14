# Hart 桌游平台 —— 单进程生产镜像
# server 进程同时提供：静态前端(dist) + /api + /ws（WebSocket 权威服务器）
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# 1) 安装依赖（利用 lockfile 缓存）
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/common/package.json packages/common/
COPY packages/agent/package.json packages/agent/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile

# 2) 拷贝源码并构建前端
FROM deps AS build
COPY . .
RUN pnpm --filter @hart/client build

# 3) 运行时镜像
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8787
COPY --from=build /app /app
EXPOSE 8787
# server 通过 tsx 直接运行 TS；CLIENT_DIST 默认指向 packages/client/dist
CMD ["pnpm", "--filter", "@hart/server", "start"]
