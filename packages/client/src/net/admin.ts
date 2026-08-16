/**
 * 管理员令牌（可选）。
 * 服务端设置 HART_ADMIN_TOKEN 后，写全局配置（/api/agents、/api/system）
 * 需要 Authorization: Bearer <token>。令牌只存 sessionStorage，不持久化。
 */
export function adminToken(): string {
  return sessionStorage.getItem('hart-admin-token') ?? '';
}

export function setAdminToken(token: string): void {
  if (token) sessionStorage.setItem('hart-admin-token', token);
  else sessionStorage.removeItem('hart-admin-token');
}

/** 带令牌的请求头（写操作使用） */
export function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = adminToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}
