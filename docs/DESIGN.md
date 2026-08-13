# Hart 桌游平台 — 总体设计

> 参考站点：[game.hullqin.cn](https://game.hullqin.cn/)（桌游合集）。Hart 取其"在线桌游合集"的产品形态，
> 视觉与交互以本设计为准，参考站仅作功能与布局参照。

## 1. 产品形态

一个在线桌游合集 Web 应用：

- **大厅**：游戏列表（卡片式），按人数筛选；每款游戏有独立主题色。
- **房间**：创建/加入房间（房间号），座位、准备、聊天、房主设置。
- **对局**：服务器权威状态，按玩家视角下发"视图"（隐藏信息只在服务端），客户端只渲染 + 上报动作。
- **本地模式**：五子棋支持本地双人（同屏轮流）；其余游戏以在线房间为主。

首批四款游戏：**五子棋、斗地主、一夜狼、阿瓦隆**。

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 包管理 | pnpm workspaces | monorepo，多 agent 并行改不同包 |
| 共享逻辑 | `packages/common`（纯 TS，零依赖） | 游戏规则单一事实来源，server/client 共用，可单测 |
| 服务端 | Node 20 + `ws` + TypeScript（tsx 运行） | 权威状态机、房间管理、WebSocket 推送 |
| 客户端 | React 18 + TypeScript + Vite + Tailwind + Zustand | 主流、agent 熟悉、构建快 |
| 测试 | vitest（common 单测）+ 脚本化 E2E | 规则正确性靠 common 单测兜底 |

## 3. 仓库结构

```
Hart/
├── pnpm-workspace.yaml
├── package.json                 # 根：scripts（dev/build/test）
├── docs/
│   ├── DESIGN.md                # 本文档
│   ├── REFERENCE_UI.md          # 参考站调研（截图 + 规则）
│   └── screenshots/
└── packages/
    ├── common/                  # 游戏框架契约 + 四款游戏纯逻辑
    │   └── src/
    │       ├── protocol.ts      # 客户端↔服务端消息协议
    │       ├── framework.ts     # GameDefinition<S,A> 契约 + 注册中心
    │       ├── types.ts         # PlayerId / RoomId / 基础类型
    │       └── games/
    │           ├── wuziqi/      # 五子棋
    │           ├── doudizhu/    # 斗地主
    │           ├── yiyelang/    # 一夜狼
    │           └── avalon/      # 阿瓦隆
    ├── server/                  # 权威服务器
    │   └── src/
    │       ├── index.ts         # 启动 ws/http
    │       ├── room.ts          # 房间生命周期、座位、准备
    │       ├── session.ts       # 连接↔玩家会话
    │       └── host.ts          # 对局托管：apply + 广播 per-player view
    └── client/                  # React 应用
        └── src/
            ├── net/             # WebSocket 客户端、重连
            ├── store/           # zustand：session/room/game 状态
            ├── ui/              # 设计系统（Button/Card/Avatar/Seat/Chat…）
            ├── pages/           # Lobby / Room / Game
            └── games/           # 四款游戏的 React UI（每款一个目录）
```

## 4. 游戏框架契约（关键依赖，所有游戏共用）

每款游戏实现 `GameDefinition`（泛型：`S` 状态、`A` 动作）：

```ts
export interface GameDefinition<S, A> {
  id: GameId;                 // 'wuziqi' | 'doudizhu' | 'yiyelang' | 'avalon'
  name: string;
  minPlayers: number;
  maxPlayers: number;
  defaultOptions: Record<string, unknown>;
  /** 开局：发牌/布置，返回完整内部状态（含秘密） */
  start(players: PlayerInfo[], options: GameOptions, rng: Rng): S;
  /** 应用动作，返回新状态 + 事件（用于动画/日志）。非法动作抛错 */
  apply(state: S, action: A, from: PlayerId): { state: S; events: GameEvent[] };
  /** 某玩家视角的视图（剥掉秘密）。客户端只拿到这个 */
  view(state: S, viewer: PlayerId): GameView;
  /** 当前轮到谁、可做什么（UI 高亮/按钮可用态） */
  turn(state: S): { active: PlayerId[]; phase: string };
  /** 终局判定 */
  result(state: S): GameResult | null;
}
```

- **服务器权威**：`start`/`apply` 只在服务端跑；客户端发 `action`，服务端校验后广播 `view`。
- **视图即 UI 契约**：`view()` 返回的 `GameView` 是该游戏 UI 的唯一输入，UI 组件签名统一为
  `({ view, me, send, players }) => JSX`，使四款游戏 UI 可完全并行开发。
- **动作**：discriminated union，每款游戏自定义，经 `protocol.ts` 的 `game.action` 包裹传输。

## 5. 通信协议（WebSocket，JSON）

客户端 → 服务端：

```
hello            { name }                     # 入场，设置昵称
room.create      { game }                     # 创建房间
room.join        { code }                     # 房间号加入
room.leave       {}
room.sit         { seat }                     # 选座
room.ready       { ready }
room.chat        { text }
room.options     { options }                  # 房主改设置
game.action      { action }                   # 对局动作
```

服务端 → 客户端：

```
welcome          { you: PlayerId, code?: RoomCode }
room.state       { room: RoomView }           # 房间/对局全量（含你的 view）
room.event       { event: GameEvent }         # 增量事件（动画/日志）
error            { message }
```

- `room.state` 中 `game: { view, turn, result }` 为你个人视角；换座位/重发全量。
- 断线重连：重连后发 `hello` + `room.join` 即恢复全量。

## 6. 模块拆分与依赖关系

```
common/protocol + framework  ──┬──> common/games/wuziqi   ──┐
                               ├──> common/games/doudizhu  ──┤
                               ├──> common/games/yiyelang  ──┼──> server/host ──> 集成
                               └──> common/games/avalon    ──┘
client/ui + net + store ───────┬──> client/games/wuziqi   ──┐
                               ├──> client/games/doudizhu  ──┤
                               ├──> client/games/yiyelang  ──┘
                               └──> client/games/avalon     ──┘
```

- **强依赖**：四款游戏都依赖 `framework.ts` 契约；四个游戏 UI 都依赖 `ui/` 设计系统与 `store`。
- **可并行**：游戏之间零依赖；游戏逻辑与游戏 UI 之间只靠 `GameView` 类型耦合（先定类型即可并行）。
- **关键路径**：契约 + 设计系统 → 游戏逻辑/UI（并行）→ 集成。

## 7. 执行节奏

1. **P0 框架（root）**：monorepo、`protocol.ts`、`framework.ts`、设计系统、client/server 骨架、本地 dev harness（不依赖真服务器即可调游戏 UI）。
2. **P1 并行（4 个游戏 agent + root）**：
   - agent×4：各负责一款游戏的 `common/games/<id>`（逻辑+单测）与 `client/games/<id>`（UI），用 dev harness 自测。
   - root：`server/`（房间/会话/host）、`client/` 大厅/房间页、net/store。
3. **P2 集成（root）**：四款游戏注册进 server/client，联机 E2E（多标签页模拟多玩家）。
4. **P3 打磨**：视觉/动效、规则边界、文档、README。

## 8. 游戏规则要点（详见各游戏目录 README / 单测）

- **五子棋**：15×15，黑先，任意五连获胜；无禁手（默认）。支持本地双人 + 联机。
- **斗地主**：54 张（含大小王），3 人各 17 张、底牌 3 张；叫分抢地主；牌型：单/对/三/三带一/三带二/顺子(≥5)/连对(≥3)/飞机/四带二/炸弹/火箭；压牌规则同型比较或炸弹/火箭；先出完胜，地主一打二。
- **一夜狼**：3–10 人，角色（狼人/爪牙/预言家/强盗/捣蛋鬼/酒鬼/酒鬼/失眠者/守夜人/村民/皮匠/猎人等）；夜晚按顺序行动（可能换牌/看牌），白天讨论后投票，得票最多者出局；狼人阵营无人出局则狼人胜，出局者为狼人则村民胜，皮匠出局则皮匠胜。
- **阿瓦隆**：5–10 人，好人（梅林/派西维尔/亚瑟忠臣）vs 坏人（莫甘娜/莫德雷德/奥伯伦/刺客/爪牙）；5 次任务，队长提案→全员投票→任务成员秘密成败；3 次任务成功好人胜（刺客可刺梅林，刺中则坏人胜），3 次失败坏人胜；连续 5 次提案被否坏人胜。

## 9. UI/UX 设计方向

- **整体**：深色"桌游夜"基调（近黑蓝灰底 + 毛玻璃卡片），每款游戏一个主题色（五子棋=琥珀、斗地主=蓝、一夜狼=红、阿瓦隆=紫），参考站的"每游戏一色"思路保留，但质感更现代。
- **大厅**：游戏卡片网格，图标 + 名称 + 人数标签 + 主题色光晕；顶部人数筛选。
- **房间**：圆桌座位布局（头像、昵称、准备状态、房主标记），中央显示游戏设置/开始按钮，侧栏聊天 + 房间号 + 邀请链接。
- **牌桌**：felt 质感桌面；手牌扇形/弧形排列，可选中；出牌区中央；对手信息沿桌边分布；倒计时、操作按钮（不出/提示/出牌）。
- **棋盘**：木纹/石质 15×15，落子动画，最后一手标记，五连高亮。
- **通用**：Toast、模态规则说明、音效占位（可选）、移动端基本可用（桌面优先）。
