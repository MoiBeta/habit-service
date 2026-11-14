/**
 * Shared frequency utilities used by HabitsService and NotificationSchedulerService.
 *
 * All date operations use UTC to stay consistent with the scheduler's minute counter.
 */

export enum TaskFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
  /** Done a single time: shown on one day at a time until it is completed. */
  ONCE = 'ONCE',
}

/**
 * Given a habit's creation date and a target date (both UTC-normalized),
 * returns the canonical entry date for that frequency period.
 *
 * - DAILY   → the target date itself
 * - ONCE    → the target date itself (the day it is being completed on)
 * - WEEKLY  → the weekday of createdAt projected onto the week of targetDate
 * - MONTHLY → the day-of-month of createdAt in the month of targetDate
 * - YEARLY  → the day+month of createdAt in the year of targetDate
 */
export function getSearchDateForFrequency(
  frequency: string,
  habitCreatedAt: Date,
  targetDate: Date,
): Date {
  switch (frequency) {
    case TaskFrequency.WEEKLY:
      return getDateWithSameDayOfWeek(habitCreatedAt, targetDate);
    case TaskFrequency.MONTHLY:
      return getDateWithSameDayOfMonth(habitCreatedAt, targetDate);
    case TaskFrequency.YEARLY:
      return getDateWithSameDayAndMonth(habitCreatedAt, targetDate);
    case TaskFrequency.DAILY:
    default:
      return normalizeDate(targetDate);
  }
}

/**
 * Returns true only when targetDate is the day this habit is due,
 * given its frequency and creation date. A habit is never due before the
 * day it starts.
 *
 * A ONCE habit is due every day from its start day until it is completed; the
 * caller checks its completion (see pickOnceEntry and getOnceDisplayDay).
 */
export function isHabitDueOnDate(
  frequency: string,
  habitCreatedAt: Date,
  targetDate: Date,
): boolean {
  if (normalizeDate(targetDate) < normalizeDate(habitCreatedAt)) {
    return false;
  }

  const searchDate = getSearchDateForFrequency(
    frequency,
    habitCreatedAt,
    targetDate,
  );
  return searchDate.getTime() === normalizeDate(targetDate).getTime();
}

/**
 * The entry that holds the state of a ONCE habit, out of its entries dated on
 * or after its start day: the completed one if there is any (the earliest),
 * otherwise the latest, which carries the subtask progress.
 */
export function pickOnceEntry<T extends { date: Date; completed: boolean }>(
  entries: T[],
): T | undefined {
  const sorted = [...entries].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  return sorted.find((e) => e.completed) ?? sorted[sorted.length - 1];
}

/**
 * The only day a ONCE habit is shown on: the day it was completed, or while it
 * is pending, the user's current day (its start day if that is still to come),
 * so a habit left undone moves to the next day.
 */
export function getOnceDisplayDay(
  habitCreatedAt: Date,
  today: Date,
  entry?: { date: Date; completed: boolean },
): Date {
  if (entry?.completed) return normalizeDate(entry.date);
  const start = normalizeDate(habitCreatedAt);
  const current = normalizeDate(today);
  return start > current ? start : current;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function normalizeDate(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Local calendar day for a UTC offset, as UTC midnight (the way habit start
 * dates and entry dates are stored).
 */
export function localDayStart(now: Date, utcOffsetMinutes: number): Date {
  return normalizeDate(new Date(now.getTime() + utcOffsetMinutes * 60_000));
}

function daysInMonthUTC(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Builds a UTC midnight date, clamping the day to the last day of the month so
 * that e.g. a habit created on the 31st is due on April 30th instead of
 * overflowing into May.
 */
function utcDateClamped(year: number, month: number, day: number): Date {
  return new Date(
    Date.UTC(year, month, Math.min(day, daysInMonthUTC(year, month))),
  );
}

/**
 * Projects the weekday of `habitCreatedAt` onto the week that contains `targetDate`.
 * E.g. habit created on Tuesday, targetDate is Friday → returns the Tuesday of that week.
 */
function getDateWithSameDayOfWeek(
  habitCreatedAt: Date,
  targetDate: Date,
): Date {
  const createdDayOfWeek = habitCreatedAt.getUTCDay();
  const targetDayOfWeek = targetDate.getUTCDay();
  const daysToAdd = createdDayOfWeek - targetDayOfWeek;

  const result = normalizeDate(targetDate);
  result.setUTCDate(result.getUTCDate() + daysToAdd);
  return result;
}

/**
 * Returns the same day-of-month as `habitCreatedAt` but in the month of `targetDate`.
 */
function getDateWithSameDayOfMonth(
  habitCreatedAt: Date,
  targetDate: Date,
): Date {
  return utcDateClamped(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    habitCreatedAt.getUTCDate(),
  );
}

/**
 * Returns the same day+month as `habitCreatedAt` but in the year of `targetDate`.
 */
function getDateWithSameDayAndMonth(
  habitCreatedAt: Date,
  targetDate: Date,
): Date {
  return utcDateClamped(
    targetDate.getUTCFullYear(),
    habitCreatedAt.getUTCMonth(),
    habitCreatedAt.getUTCDate(),
  );
}
