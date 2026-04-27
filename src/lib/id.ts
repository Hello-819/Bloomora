export function createId(prefix = 'id'): string {
  const cryptoId = globalThis.crypto?.randomUUID?.();
  if (cryptoId) return `${prefix}_${cryptoId}`;
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
