import { describe, expect, it } from 'vitest';
import {
  deepEqual,
  findLegalAction,
  parseResponse,
  validateDecision,
} from './protocol.js';

describe('Agent Protocol', () => {
  it('解析纯 JSON 输出', () => {
    const r = parseResponse('{"action":{"t":"place","row":7,"col":7}}');
    expect(r.action).toEqual({ t: 'place', row: 7, col: 7 });
  });

  it('解析 markdown 代码块包裹的输出', () => {
    const r = parseResponse('好的，我的选择是：\n```json\n{"action":{"t":"pass"},"reasoning":"没牌"}\n```');
    expect(r.action).toEqual({ t: 'pass' });
    expect(r.reasoning).toBe('没牌');
  });

  it('非法输出抛错', () => {
    expect(() => parseResponse('我不出牌')).toThrow();
  });

  it('deepEqual 比较动作', () => {
    expect(deepEqual({ t: 'place', row: 1, col: 2 }, { t: 'place', row: 1, col: 2 })).toBe(true);
    expect(deepEqual({ t: 'place', row: 1, col: 2 }, { t: 'place', row: 2, col: 1 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
  });

  it('validateDecision 校验合法/非法动作', () => {
    const legal = [{ t: 'pass' }, { t: 'play', cards: [] }];
    expect(validateDecision({ action: { t: 'pass' } }, legal).ok).toBe(true);
    const bad = validateDecision({ action: { t: 'bid', score: 3 } }, legal);
    expect(bad.ok).toBe(false);
  });

  it('findLegalAction 找到匹配项', () => {
    const legal = [{ t: 'a' }, { t: 'b' }];
    expect(findLegalAction(legal, { t: 'b' })).toEqual({ t: 'b' });
    expect(findLegalAction(legal, { t: 'c' })).toBeNull();
  });
});
