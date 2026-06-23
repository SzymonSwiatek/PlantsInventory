/**
 * Step a string-valued numeric field by `delta`, clamping to `min`.
 *
 * - Empty or non-integer `current` with `delta === 1` → `String(min)`.
 * - Empty or non-integer `current` with `delta === -1` → returned unchanged
 *   (so non-numeric free-typed input is left alone on decrement).
 * - Otherwise returns `max(min, parsed + delta)` as a string. Never goes below
 *   `min` and never produces an empty string.
 */
export function stepValue(current: string, delta: 1 | -1, min = 1): string {
  if (current === "" || !/^\d+$/.test(current)) {
    return delta === 1 ? String(min) : current;
  }
  return String(Math.max(min, parseInt(current, 10) + delta));
}

export function canDecrement(current: string, min = 1): boolean {
  if (current === "" || !/^\d+$/.test(current)) return false;
  return parseInt(current, 10) > min;
}
