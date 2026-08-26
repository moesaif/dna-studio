const MIN_GAP_MS = 3_000;
const HOURLY_LIMIT = 20;
const HOUR_MS = 3_600_000;

const attempts = new Map<string, number[]>();

export interface CooldownResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * In-memory throttle for the provider test endpoint, which makes authenticated
 * outbound calls with user-supplied credentials. Bounds abuse; not an audit
 * control — counters reset when the process does.
 */
export function checkCooldown(userId: string, now: number = Date.now()): CooldownResult {
  const recent = (attempts.get(userId) ?? []).filter((t) => now - t < HOUR_MS);

  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < MIN_GAP_MS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((MIN_GAP_MS - (now - last)) / 1000) };
  }

  if (recent.length >= HOURLY_LIMIT) {
    const oldest = recent[0];
    return { allowed: false, retryAfterSeconds: Math.ceil((HOUR_MS - (now - oldest)) / 1000) };
  }

  recent.push(now);
  attempts.set(userId, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test hook. */
export function __resetCooldowns(): void {
  attempts.clear();
}
