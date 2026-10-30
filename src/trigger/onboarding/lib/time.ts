/**
 * DEMO_TIME_SCALE shrinks every reminder/escalation wait so a demo fits in one sitting:
 * 720 turns 24h into 2 minutes. Unset or 1 = real time.
 */
export function timeScale(): number {
  const raw = process.env.DEMO_TIME_SCALE?.trim();
  if (!raw) return 1;
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale < 1) throw new Error("DEMO_TIME_SCALE must be a number of 1 or more");
  return scale;
}

/** Real seconds to wait for a nominal number of hours. At least 30s, so demo emails can't pile up. */
export function scaledSeconds(hours: number): number {
  return Math.max(30, Math.round((hours * 3600) / timeScale()));
}

/** "24h", or "24h (demo: 2 min)" while DEMO_TIME_SCALE is on. */
export function describeHours(hours: number): string {
  if (timeScale() === 1) return `${hours}h`;
  const seconds = scaledSeconds(hours);
  return `${hours}h (demo: ${seconds < 120 ? `${seconds}s` : `${Math.round(seconds / 60)} min`})`;
}

/** "2026-11-12" → a Date at midnight UTC. Accepts ISO dates and whatever Sheets shows (e.g. 11/12/2026). */
export function parseDate(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const date = iso ? new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))) : new Date(`${trimmed} UTC`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** "2026-11-12 09:30 UTC", for sheet cells. */
export function stamp(date = new Date()): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
