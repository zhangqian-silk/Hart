# Agent 层设计（对照 V8 设计文档）

平台定位是 **AI Agent 游戏环境**：Agent 是玩家，平台是环境。本层实现 V8 文档
「Agent 部分」的全部能力，落在 `packages/agent`，并通过 `packages/server` 集成到联机房间。

## 1. V8 概念 → 实现映射

| V8 概念 | 说明 | 实现位置 |
|---|---|---|
| Agent Provider | 执行能力，生命周期 start→decide→stop | `src/types.ts` `AgentProvider`；`src/provider/*` |
| ├ Scripted | 内置启发式（离线基线，四款游戏各有策略） | `src/provider/scripted.ts` |
| ├ HTTP Agent | POST 决策上下文到 webhook | `src/provider/http.ts` |
| ├ Claude Code | 子进程调用 `claude -p --output-format json` | `src/provider/cli.ts` |
| └ Codex | 子进程调用 `codex exec` | `src/provider/cli.ts` |
| Agent Profile | 人格：Persona / Strategy / Game Policy | `src/profiles.ts`（内置 12 个档案） |
| Prompt Pipeline | Base+Rules+Role+Persona+Strategy+Obs+Memory+Schema | `src/prompt.ts` |
| Context Provider | 隐藏信息过滤：只把玩家视角 view 交给 Agent | 复用 common 的 `GameDefinition.view` |
| Memory System | Profile / Game / Relationship 三层记忆 | `src/memory.ts` |
| Agent Protocol | 输入 `{game,role,visibleState,actions}` / 输出 `{action}` + Validator | `src/protocol.ts` |
| getAvailableActions | 枚举合法动作 | common `GameDefinition.legalActions` |
| Event Replay | 对局录像与可复现重放 | `src/replay.ts`；server `data/replays/*.json` |
| 评估体系 | 多档案自对弈、胜率排行榜 | `src/arena.ts`；`scripts/arena.ts` |

## 2. 决策数据流

```
GameState (server 权威)
   │  GameDefinition.view(state, viewer)         ← Context Provider：剥离秘密
   ▼
player view ──┐
legalActions(state, viewer) ──┤→ AgentContext {game, role, visibleState, actions, memory, history}
MemoryStore.snapshot() ───────┘
   │  AgentProvider.decide(ctx)                  ← scripted / http / claude-code / codex
   ▼
AgentDecision {action, reasoning?}
   │  validateDecision(decision, legalActions)   ← Validator：动作必须属于合法集合
   ▼
GameDefinition.apply(state, action) → events → 广播 + 写入 replay
```

非法决策兜底：`AgentDriver` / `playGame` 在校验失败时用随机合法动作兜底，保证对局不卡死；
兜底会在 `DecisionRecord.fallback=true` 中标记，便于评估时区分。

## 3. 服务器集成（联机 AI 座位）

- 座位可由 `AgentSession`（`packages/server/src/agent-session.ts`）占据，与人类 `Session` 同构。
- 协议扩展：`room.add_agent` / `room.remove_agent`（仅房主）；`agent.profiles` 下发可选档案；
  `SeatInfo.agent` 携带 `{profileId, profileName, kind, status}`，`status` 在决策期间为 thinking。
- 驱动：`GameHost` 实现 `DrivenHost`（新增 `legalActionsFor`），每次动作后 `pumpAgents()`
  调用 `AgentDriver.pump()` 驱动所有轮到的 AI；连续 AI 回合通过 `afterAction` 递归衔接。
- 录像：终局把事件序列写入 `packages/server/data/replays/<game>-<code>-<ts>.json`。

## 4. 可复现性（Event Replay）

`playGame` 从入参 rng 派生确定性 seed，用 `seededRng(seed)` 开局并做兜底抽取，
并把 seed 与 options 写入 `GameTranscript`。`replayTranscript` 用同一 seed+options
重建对局、按记录顺序重放全部已执行动作，校验最终胜者一致——对随机发牌（斗地主）与
随机身份（一夜狼/阿瓦隆）同样成立（见 `src/arena.test.ts`）。

## 5. 评估体系用法

```
pnpm --filter @hart/agent arena                       # 四款游戏各 10 局，打印排行榜
pnpm --filter @hart/agent arena -- --games wuziqi     # 只跑指定游戏
pnpm --filter @hart/agent arena -- --rounds 50        # 自定义局数
```

排行榜按 profile 统计 胜/负/胜率/平均用时；每局 transcript 存到 `data/arena/`。

## 6. 扩展新 Provider

实现 `AgentProvider`（start/decide/stop），在 `src/provider/index.ts` 的
`providerFactories` 注册一个 kind。房间即可通过 `room.add_agent{providerKind}` 使用。
外部 LLM 推荐走 HTTP Agent：接收 `{game, role, visibleState, actions}`，返回
`{action, reasoning?}`（action 必须是 actions 中的某一项）。

## 7. 真实 Claude CLI 实测

`ClaudeCodeProvider` 已用真实 `claude` CLI（Claude Code v2.1.232，`-p --output-format json`）
完整跑通对局，脚本见 `scripts/claude-game.ts` / `scripts/claude-test.ts`：

```
pnpm --filter @hart/agent claude-test                       # Claude 下五子棋（vs 脚本AI）
pnpm --filter @hart/agent claude-game -- --game yiyelang    # Claude 玩指定游戏
pnpm --filter @hart/agent claude-game -- --game avalon --max-steps 45
```

每局对局录像保存到 `data/claude-games/<game>-<ts>.json`。实测结果（Claude=Sherlock 档案，
其余为脚本 AI）：

| 游戏 | Claude 角色 | 步数 | Claude 决策合法率 | 结果 |
|---|---|---|---|---|
| 五子棋 | 黑方 | 31 | 16/16（100%） | Claude 胜（五子连珠） |
| 一夜狼 | 狼人 | 15 | 3/3（100%） | 狼人阵营胜 |
| 阿瓦隆 | 亚瑟忠臣 | 49 | 9/10（90%） | 未分胜负（步数上限）|

要点验证：
- **真机决策**：每步动作附带 Claude 的中文推理（占天元、冲四防守、任务失败反推坏人等）。
- **Context Provider 生效**：一夜狼/阿瓦隆中 Claude 只能看到自己视角（狼人只知同伴为空、
  忠臣看不到身份），仍据此做出合理博弈。
- **Validator 生效**：阿瓦隆出现 1 次不在合法集合的动作，被 `validateDecision` 拦截并用
  合法动作兜底（`DecisionRecord.fallback=true`），对局未因此中断。
- **CLI 输出解析**：`claude --output-format json` 外层返回 `{result: "..."}`，Provider 先取
  `result` 再 `parseResponse`，能容忍代码块与前后噪声。
