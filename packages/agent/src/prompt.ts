import type { AgentContext, AgentProfile } from './types.js';

/**
 * Prompt Pipeline（V8）。
 * 首轮 Prompt = Base Identity + Game Rules + Role Instruction + Persona
 *              + Strategy + Observation + Memory + Output Schema。
 * 后续轮 Prompt = Continuation + Observation + Memory + Output Schema
 *              （身份/规则/历史已在 CLI 会话中，只需增量观察）。
 */
export interface PromptSection {
  label: string;
  content: string;
}

export interface PromptInput {
  profile: AgentProfile;
  ctx: AgentContext;
  /** 游戏规则文本（来自 GameMeta.rules） */
  rules: string;
}

const OUTPUT_SCHEMA =
  '只输出一个 JSON 对象：{"action": <从 legalActions 中选择的一个动作>, ' +
  '"reasoning": "<简短理由>"}。不要输出其他内容。';

/**
 * 静态段落：同局内不变（身份/规则/角色/人格/策略）。
 * 可作为 system 提示并启用 prompt caching；也可拼入首轮 prompt。
 */
export function buildStaticSections(input: PromptInput): PromptSection[] {
  const { profile, ctx, rules } = input;
  const sections: PromptSection[] = [];

  sections.push({
    label: 'Base Identity',
    content:
      profile.systemPrompt ??
      `你是桌游平台上的 AI 玩家「${profile.name}」。你只能通过提交动作参与游戏，` +
        `看不到其他玩家的秘密信息。请只输出合法动作。`,
  });

  sections.push({ label: 'Game Rules', content: rules });

  sections.push({
    label: 'Role Instruction',
    content: `本局游戏：${ctx.game}；你的角色：${ctx.role}；你的玩家 id：${ctx.you}。`,
  });

  sections.push({ label: 'Persona', content: profile.persona });

  const strategyParts = [profile.strategy];
  const gamePolicy = profile.gamePolicy?.[ctx.game];
  if (gamePolicy) strategyParts.push(`本游戏策略：${gamePolicy}`);
  sections.push({ label: 'Strategy', content: strategyParts.join('\n') });

  return sections;
}

/**
 * 动态段落：每轮变化（观察 + 记忆）。
 */
export function buildDynamicSections(input: PromptInput): PromptSection[] {
  const { ctx } = input;
  return [
    {
      label: 'Observation',
      content: JSON.stringify(
        {
          visibleState: ctx.visibleState,
          turn: ctx.turn,
          legalActions: ctx.actions,
          recentEvents: ctx.history.slice(-12),
          players: ctx.players,
        },
        null,
        2,
      ),
    },
    {
      label: 'Memory',
      content: JSON.stringify(ctx.memory, null, 2),
    },
  ];
}

export function buildSections(input: PromptInput): PromptSection[] {
  return [
    ...buildStaticSections(input),
    ...buildDynamicSections(input),
    { label: 'Output Schema', content: OUTPUT_SCHEMA },
  ];
}

function sectionsToText(sections: PromptSection[]): string {
  return sections.map((s) => `## ${s.label}\n${s.content}`).join('\n\n');
}

/** 首轮完整 Prompt（身份/规则/人格/策略 + 观察 + 记忆 + 输出格式） */
export function buildInitialPrompt(input: PromptInput): string {
  return sectionsToText(buildSections(input));
}

/**
 * 后续轮 Prompt（会话已保留身份/规则/人格/策略/历史）。
 * 只含：续场说明 + 新观察 + 记忆快照 + 输出格式提醒。
 */
export function buildTurnPrompt(input: PromptInput): string {
  const { ctx } = input;
  return sectionsToText([
    {
      label: 'Continuation',
      content:
        '这是同一局游戏的后续回合。你的身份、游戏规则、角色、人格与策略已在本会话上下文中，' +
        '此前的观察与决策历史也已保留，无需重复。请仅根据以下新观察继续决策。',
    },
    {
      label: 'Observation',
      content: JSON.stringify(
        {
          visibleState: ctx.visibleState,
          turn: ctx.turn,
          legalActions: ctx.actions,
          players: ctx.players,
        },
        null,
        2,
      ),
    },
    {
      label: 'Memory',
      content: JSON.stringify(ctx.memory, null, 2),
    },
    { label: 'Output Schema', content: OUTPUT_SCHEMA },
  ]);
}

/** @deprecated 改用 buildInitialPrompt */
export const buildPrompt = buildInitialPrompt;

/**
 * 系统提示文本（静态段落 + 输出格式）。
 * 同局内不变，直连 Provider 可作为 system 参数并启用 prompt caching。
 */
export function buildSystemPrompt(input: PromptInput): string {
  return sectionsToText([
    ...buildStaticSections(input),
    { label: 'Output Schema', content: OUTPUT_SCHEMA },
  ]);
}

/** 动态观察文本（每轮变化的用户消息） */
export function buildObservationPrompt(input: PromptInput): string {
  return sectionsToText(buildDynamicSections(input));
}
