# 部署指南

Hart 由两部分组成：`@hart/server`（Node + WebSocket 权威服务器，含 AI 驱动）与
`@hart/client`（Vite 构建的静态前端）。前端通过相对路径 `/ws`、`/api` 连接后端，
因此二者需在**同一 origin** 下对外提供。

## 形态 A：单进程（推荐）

`@hart/server` 在生产下会直接托管前端构建产物（`packages/client/dist`）+ `/api` + `/ws`，
一个进程即完整可部署单元，无需额外反向代理。

```bash
pnpm install
pnpm --filter @hart/client build     # 产出 packages/client/dist
PORT=8787 pnpm --filter @hart/server start
# 打开 http://<host>:8787 —— 前端、API、WebSocket 同源
```

健康检查：`GET /healthz` → `{"ok":true,"rooms":N}`。

### Docker

```bash
docker build -t hart .
docker run -p 8787:8787 -e PORT=8787 hart
```

## 形态 B：前后端分离

前端静态托管（任意 CDN/静态站）、后端单独跑 `@hart/server`，再由前置网关把
`/ws` 与 `/api` 反代到后端（务必转发 WebSocket Upgrade 头）。前端与后端需同域，
或自行改造 `packages/client/src/net/client.ts` 使用绝对 WS 地址（如注入 `VITE_WS_URL`）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `CLIENT_DIST` | `../client/dist` | 前端产物目录（相对 server 源码），可指向绝对路径 |

> 若 `CLIENT_DIST/index.html` 不存在，server 只提供 `/api` 与 `/ws`（纯后端模式）。

## 运行时产物

对局结束会把回放写入 `packages/server/data/replays/*.json`（已在 `.gitignore`）。
如需持久化，挂载该目录到卷。

## 说明

- WebSocket 升级在任意路径生效（客户端固定用 `/ws`）。反代场景需显式转发 Upgrade。
- `claude-code` / `codex` Provider 需容器内存在对应 CLI 且完成登录，否则用 `scripted`/`http`。
