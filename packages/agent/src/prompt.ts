import type { AgentContext, AgentProfile } from './types.js';

/**
 * Prompt Pipeline（V8）。
 * 最终 Prompt = Base Identity + Game Rules + Role Instruction + Persona
 *              + Strategy + Observation + Memory + Output Schema。
 * PromptBuilder 只负责组装，不做决策。
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

export function buildSections(input: PromptInput): PromptSection[] {
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

  sections.push({
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
  });

  sections.push({
    label: 'Memory',
    content: JSON.stringify(ctx.memory, null, 2),
  });

  sections.push({
    label: 'Output Schema',
    content:
      '只输出一个 JSON 对象：{"action": <从 legalActions 中选择的一个动作>, ' +
      '"reasoning": "<简短理由>"}。不要输出其他内容。',
  });

  return sections;
}

/** 组装最终 Prompt 文本 */
export function buildPrompt(input: PromptInput): string {
  return buildSections(input)
    .map((s) => `## ${s.label}\n${s.content}`)
    .join('\n\n');
}
