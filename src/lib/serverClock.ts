export const CLOCK_FRESH_MS = 90000;
export const CLOCK_POLL_MS = 60000;
export const CLOCK_RETRY_MS = 10000;
export const CLOCK_MAX_RTT_MS = 5000;
export interface ClockSample { userId: string; revision: number; serverMs: number; receivedAt: number; rtt: number }

export function clockSample(value: unknown, userId: string, revision: number, sentAt: number, receivedAt: number): ClockSample | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value), rtt = receivedAt - sentAt;
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value || !Number.isFinite(rtt) || rtt < 0 || rtt > CLOCK_MAX_RTT_MS) return null;
  return { userId, revision, serverMs: time + rtt / 2, receivedAt, rtt };
}
// Monotonic elapsed time avoids device wall-clock jumps after confirmation.
export function confirmedClock(sample: ClockSample | null, userId: string | undefined, revision: number, elapsed: number): Date | null {
  if (!sample || sample.userId !== userId || sample.revision !== revision) return null;
  const age = elapsed - sample.receivedAt;
  if (!Number.isFinite(age) || age < 0 || age >= CLOCK_FRESH_MS) return null;
  return new Date(sample.serverMs + age);
}
export async function requestClock(options: {
  request: () => PromiseLike<{ data: { server_now?: unknown } | null; error: unknown }>;
  current: () => boolean; elapsed: () => number; userId: string; revision: number;
  confirmed: (sample: ClockSample) => void; failed: () => void;
}) {
  const sentAt = options.elapsed();
  try {
    const { data, error } = await options.request();
    if (!options.current()) return;
    const sample = !error && clockSample(data?.server_now, options.userId, options.revision, sentAt, options.elapsed());
    if (sample) options.confirmed(sample); else options.failed();
  } catch { if (options.current()) options.failed(); }
}
