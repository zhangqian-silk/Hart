import type { ProviderFactory } from '../types.js';
import { createScriptedProvider } from './scripted.js';
import { createHttpProvider } from './http.js';
import { createClaudeCodeProvider, createCodexProvider } from './cli.js';

/** 内置 Provider 工厂注册表 */
export const providerFactories = new Map<string, ProviderFactory>([
  ['scripted', createScriptedProvider],
  ['http', createHttpProvider],
  ['claude-code', createClaudeCodeProvider],
  ['codex', createCodexProvider],
]);

export function registerProvider(kind: string, factory: ProviderFactory): void {
  providerFactories.set(kind, factory);
}

export function createProvider(
  kind: string,
  profile: import('../types.js').AgentProfile,
  options?: Record<string, unknown>,
): import('../types.js').AgentProvider {
  const factory = providerFactories.get(kind);
  if (!factory) throw new Error(`未知 Provider 类型: ${kind}`);
  return factory(profile, options);
}

export { ScriptedProvider, createScriptedProvider } from './scripted.js';
export { HttpProvider, createHttpProvider } from './http.js';
export {
  ClaudeCodeProvider,
  CodexProvider,
  createClaudeCodeProvider,
  createCodexProvider,
} from './cli.js';
