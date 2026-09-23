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
}

/**
 * Given a habit's creation date and a target date (both UTC-normalized),
 * returns the canonical entry date for that frequency period.
 *
 * - DAILY   → the target date itself
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
 * given its frequency and creation date.
 */
export function isHabitDueOnDate(
  frequency: string,
  habitCreatedAt: Date,
  targetDate: Date,
): boolean {
  const searchDate = getSearchDateForFrequency(
    frequency,
    habitCreatedAt,
    targetDate,
  );
  return searchDate.getTime() === normalizeDate(targetDate).getTime();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeDate(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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

  const result = new Date(targetDate);
  result.setUTCDate(result.getUTCDate() + daysToAdd);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Returns the same day-of-month as `habitCreatedAt` but in the month of `targetDate`.
 */
function getDateWithSameDayOfMonth(
  habitCreatedAt: Date,
  targetDate: Date,
): Date {
  const result = new Date(targetDate);
  result.setUTCDate(habitCreatedAt.getUTCDate());
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Returns the same day+month as `habitCreatedAt` but in the year of `targetDate`.
 */
function getDateWithSameDayAndMonth(
  habitCreatedAt: Date,
  targetDate: Date,
): Date {
  const result = new Date(targetDate);
  result.setUTCMonth(habitCreatedAt.getUTCMonth());
  result.setUTCDate(habitCreatedAt.getUTCDate());
  result.setUTCHours(0, 0, 0, 0);
  return result;
}
