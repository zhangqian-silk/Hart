/**
 * 密钥脱敏工具。
 * 所有对外接口（REST / WS）返回密钥时必须脱敏；
 * 保存时含 • 的值视为"沿用原值"，由存储层合并。
 */

/** 脱敏：保留后 4 位，其余以 • 代替 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 4) return '••••';
  return `••••${secret.slice(-4)}`;
}

/** 是否为脱敏值（含 • 即视为脱敏占位，不可当明文使用） */
export function isMaskedSecret(s: string): boolean {
  return s.includes('•');
}
