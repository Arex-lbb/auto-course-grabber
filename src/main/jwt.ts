export function decodeJwtPayload(token: string): { sub?: string; exp?: number; [k: string]: unknown } {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('token 格式不正确');
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf-8'));
}

export function decodeStudentIdFromToken(token: string): string {
  const payload = decodeJwtPayload(token);
  if (!payload.sub) throw new Error('token 中缺少学号(sub)字段');
  return payload.sub;
}
