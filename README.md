# Hart 桌游

在线桌游合集，参考 [game.hullqin.cn](https://game.hullqin.cn/) 的产品形态，支持在线联机对战。

同时是 **AI Agent 游戏环境平台**（V8 设计）：Agent 是玩家，平台是环境。
支持人类与 AI 同桌对战，内置 Agent 评估体系。

内置四款游戏：

| 游戏 | 人数 | 主题色 | 说明 |
|---|---|---|---|
| 五子棋 | 2 人 | 琥珀 | 15×15 黑白对弈，五连即胜；支持本地双人 |
| 斗地主 | 3 人 | 蓝 | 叫分抢地主，完整牌型与压牌规则 |
| 一夜狼 | 3–10 人 | 红 | 一夜身份推理，夜晚行动 + 白天投票 |
| 阿瓦隆 | 5–10 人 | 紫 | 任务阵营对抗，梅林/刺客终局 |

## 技术栈

- **monorepo**：pnpm workspaces
- `packages/common`：纯 TS 游戏逻辑（单一事实来源，服务端/客户端共享，vitest 单测）
- `packages/server`：Node + `ws` 权威服务器（房间、座位、准备、聊天、per-player 视图）
- `packages/client`：React 18 + Vite + Tailwind + Zustand
- `packages/agent`：AI Agent 接入层（Provider / Profile / Prompt Pipeline / Memory / Arena / Replay）

核心设计：游戏实现 `GameDefinition` 契约（`start` / `apply` / `view` / `turn` / `result` / `legalActions`），
服务器权威运行，按玩家视角下发视图（隐藏信息只在服务端），客户端只渲染 + 上报动作。
Agent 通过 `AgentProvider` 接入，`AgentDriver` 驱动 AI 座位自动行动。
详见 [docs/DESIGN.md](docs/DESIGN.md)。

## 快速开始

```bash
pnpm install
pnpm dev          # 同时启动 server(:8787) 与 client(:5173)
```

打开 http://localhost:5173 ，输入昵称，创建房间或输入房间号加入。

### 本地试玩（不开服务器也能调游戏 UI）

- http://localhost:5173/local/wuziqi?players=2
- http://localhost:5173/local/doudizhu?players=3
- http://localhost:5173/local/yiyelang?players=4
- http://localhost:5173/local/avalon?players=5

页面顶部可切换"视角"，模拟多名玩家。

## 测试

```bash
pnpm test                       # common 单测（86 个用例）
pnpm --filter @hart/agent test  # agent 单测（23 个用例）
pnpm -r typecheck               # 四个包类型检查
pnpm --filter @hart/client build

# 联机 E2E（先启动 server）
pnpm --filter @hart/server start
pnpm --filter @hart/server exec tsx scripts/e2e.ts

# AI 对战 E2E（人类 + AI 五子棋）
pnpm --filter @hart/server exec tsx scripts/e2e-agent.ts

# Agent 评估（四款游戏自对弈排行榜）
pnpm --filter @hart/agent arena

# 真实 Claude CLI 实测（需本机已安装并登录 claude）
pnpm --filter @hart/agent claude-test                    # Claude 下五子棋
pnpm --filter @hart/agent claude-game -- --game avalon   # Claude 玩指定游戏，录像存 data/claude-games/
```

## 目录

```
packages/
  common/src/
    framework.ts        # GameDefinition 契约 + 注册中心 + LocalHost
    protocol.ts         # WebSocket 消息协议
    games/<id>/         # 四款游戏逻辑 + 单测
  agent/src/
    types.ts            # AgentProvider / AgentProfile / AgentContext
    protocol.ts         # V8 Agent Protocol（输入输出 + Validator）
    prompt.ts           # Prompt Pipeline（Base+Rules+Role+Persona+Strategy+Observation+Memory+Schema）
    memory.ts           # 三层记忆（Profile / Game / Relationship）
    profiles.ts         # 内置档案（Sherlock / Loki / Commander / 新手）
    host.ts             # playGame + AgentDriver（驱动 AI 座位）
    arena.ts            # 评估体系（多局自对弈 + 排行榜）
    replay.ts           # 回放（保存/加载/重放验证）
    provider/
      scripted.ts       # 内置启发式 Provider（离线可跑）
      http.ts           # HTTP Agent（webhook）
      cli.ts            # Claude Code / Codex CLI Provider
  server/src/
    room.ts / host.ts / session.ts / index.ts
    agent-session.ts    # AI 座位会话
  client/src/
    net/ store/ ui/ pages/ games/<id>/
docs/
  DESIGN.md             # 总体设计与模块依赖
  REFERENCE_UI.md       # 参考站调研
  screenshots/          # 实现截图
```
