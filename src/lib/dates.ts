export function nowIso(): string {
  return new Date().toISOString();
}

export function dateKey(input: string | number | Date = new Date()): string {
  const date = new Date(input);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function startOfDayMs(input: string | number | Date = new Date()): number {
  const date = new Date(input);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function startOfWeekMs(input: string | number | Date = new Date()): number {
  const date = new Date(input);
  const d = date.getDay();
  const diff = d === 0 ? -6 : 1 - d;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff).getTime();
}

export function addDaysMs(ms: number, days: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function isSameLocalDay(a: string | number | Date, b: string | number | Date): boolean {
  return dateKey(a) === dateKey(b);
}
