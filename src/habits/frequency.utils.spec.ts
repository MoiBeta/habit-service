import { describe, expect, it } from '@jest/globals';
import {
  TaskFrequency,
  getOnceDisplayDay,
  getSearchDateForFrequency,
  isHabitDueOnDate,
  localDayStart,
  pickOnceEntry,
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

  describe('ONCE', () => {
    const start = d('2026-11-10');
    const entry = (iso: string, completed: boolean) => ({ date: d(iso), completed });

    it('a pending habit is shown on the current day only', () => {
      expect(getOnceDisplayDay(start, d('2026-11-10'))).toEqual(d('2026-11-10'));
      // Not completed on the 10th or 11th: it moved to the 12th.
      expect(getOnceDisplayDay(start, d('2026-11-12'))).toEqual(d('2026-11-12'));
      expect(
        getOnceDisplayDay(start, d('2026-11-12'), entry('2026-11-10', false)),
      ).toEqual(d('2026-11-12'));
    });

    it('a pending habit that has not started is shown on its start day', () => {
      expect(getOnceDisplayDay(start, d('2026-11-08'))).toEqual(start);
    });

    it('a completed habit stays on the day it was completed', () => {
      const done = entry('2026-11-11', true);
      expect(getOnceDisplayDay(start, d('2026-11-11'), done)).toEqual(d('2026-11-11'));
      expect(getOnceDisplayDay(start, d('2026-11-20'), done)).toEqual(d('2026-11-11'));
    });

    it('picks the completed entry, or the latest one while pending', () => {
      expect(pickOnceEntry([])).toBeUndefined();
      expect(
        pickOnceEntry([entry('2026-11-12', false), entry('2026-11-10', false)])?.date,
      ).toEqual(d('2026-11-12'));
      expect(
        pickOnceEntry([entry('2026-11-12', false), entry('2026-11-11', true)])?.date,
      ).toEqual(d('2026-11-11'));
    });
  });
});
