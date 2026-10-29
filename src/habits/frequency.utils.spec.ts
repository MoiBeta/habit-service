import { describe, expect, it } from '@jest/globals';
import {
  TaskFrequency,
  getSearchDateForFrequency,
  isHabitDueOnDate,
  localDayStart,
} from './frequency.utils';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('frequency utils', () => {
  it('MONTHLY habit created on the 31st is due on the last day of shorter months', () => {
    const createdAt = d('2026-01-31');
    expect(isHabitDueOnDate(TaskFrequency.MONTHLY, createdAt, d('2026-04-30'))).toBe(true);
    expect(isHabitDueOnDate(TaskFrequency.MONTHLY, createdAt, d('2026-02-28'))).toBe(true);
    expect(isHabitDueOnDate(TaskFrequency.MONTHLY, createdAt, d('2026-05-01'))).toBe(false);
    expect(isHabitDueOnDate(TaskFrequency.MONTHLY, createdAt, d('2026-05-31'))).toBe(true);
  });

  it('YEARLY habit created on Feb 29 is due on Feb 28 of non-leap years', () => {
    const createdAt = d('2028-02-29');
    expect(isHabitDueOnDate(TaskFrequency.YEARLY, createdAt, d('2029-02-28'))).toBe(true);
    expect(isHabitDueOnDate(TaskFrequency.YEARLY, createdAt, d('2029-03-01'))).toBe(false);
  });

  it('YEARLY search date does not overflow when the target day is past the created month length', () => {
    const createdAt = d('2026-02-10');
    expect(
      getSearchDateForFrequency(TaskFrequency.YEARLY, createdAt, d('2027-01-31')).toISOString(),
    ).toBe(d('2027-02-10').toISOString());
  });

  it('WEEKLY habit is due only on its weekday', () => {
    const createdAt = d('2026-10-27'); // Tuesday
    expect(isHabitDueOnDate(TaskFrequency.WEEKLY, createdAt, d('2026-11-03'))).toBe(true);
    expect(isHabitDueOnDate(TaskFrequency.WEEKLY, createdAt, d('2026-11-04'))).toBe(false);
  });

  it('a habit is not due before its start day', () => {
    const startsAt = d('2026-11-05');
    expect(isHabitDueOnDate(TaskFrequency.DAILY, startsAt, d('2026-11-04'))).toBe(false);
    expect(isHabitDueOnDate(TaskFrequency.DAILY, startsAt, d('2026-11-05'))).toBe(true);
    expect(isHabitDueOnDate(TaskFrequency.WEEKLY, startsAt, d('2026-10-29'))).toBe(false);
    expect(isHabitDueOnDate(TaskFrequency.WEEKLY, startsAt, d('2026-11-12'))).toBe(true);
  });

  it('localDayStart returns the local calendar day for the offset', () => {
    // Tuesday 21:00 in UTC-5 is already Wednesday in UTC.
    const now = new Date('2026-10-28T02:00:00.000Z');
    expect(localDayStart(now, -300).toISOString()).toBe(d('2026-10-27').toISOString());
    expect(localDayStart(now, 0).toISOString()).toBe(d('2026-10-28').toISOString());
  });
});
