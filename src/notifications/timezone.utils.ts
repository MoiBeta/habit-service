/**
 * Wall-clock helpers for IANA time zones (e.g. "America/Bogota"), based on
 * Intl so daylight saving time changes are handled by the time zone database.
 */

/** A local calendar day (as UTC midnight) and minute of that day. */
export interface LocalSlot {
  day: Date;
  minute: number;
}

const MINUTE_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Local wall-clock time of `instant` in `timeZone`, as minutes since the epoch. */
function wallClockMinutes(instant: Date, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) /
    MINUTE_MS
  );
}

function toSlot(wallMinutes: number): LocalSlot {
  const minute = ((wallMinutes % 1440) + 1440) % 1440;
  return { day: new Date((wallMinutes - minute) * MINUTE_MS), minute };
}

/** UTC offset of `timeZone` at `instant`, in minutes (e.g. -300 for UTC-5). */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const floored = Math.floor(instant.getTime() / MINUTE_MS);
  return wallClockMinutes(new Date(floored * MINUTE_MS), timeZone) - floored;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * Local times whose reminders are due during the minute that starts at `now`
 * (seconds are ignored). Usually that is the current local minute, but around
 * daylight saving time changes:
 * - when clocks go forward, the skipped local minutes are returned together
 *   with the first minute after the jump, so those reminders fire late
 *   instead of being lost;
 * - when clocks go back, the repeated local minutes return nothing the second
 *   time, so those reminders fire only once.
 */
export function dueLocalSlots(now: Date, timeZone: string): LocalSlot[] {
  const nowMinute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const current = wallClockMinutes(new Date(nowMinute), timeZone);
  const previous = wallClockMinutes(new Date(nowMinute - MINUTE_MS), timeZone);

  // Clocks went back during the last minute: this local minute already happened.
  if (current <= previous) return [];

  // Clocks went back recently (DST shifts are at most a few hours): skip local
  // minutes that already happened with the previous offset.
  const offsetNow = offsetMinutesAt(new Date(nowMinute), timeZone);
  const offsetBefore = offsetMinutesAt(
    new Date(nowMinute - 3 * 60 * MINUTE_MS),
    timeZone,
  );
  if (offsetBefore > offsetNow) {
    const shift = offsetBefore - offsetNow;
    const sameWallClockEarlier = wallClockMinutes(
      new Date(nowMinute - shift * MINUTE_MS),
      timeZone,
    );
    if (sameWallClockEarlier === current) return [];
  }

  const slots: LocalSlot[] = [];
  for (let wall = previous + 1; wall <= current; wall++) {
    slots.push(toSlot(wall));
  }
  return slots;
}
