import { describe, expect, it } from '@jest/globals';
import {
  dueLocalSlots,
  isValidTimeZone,
  offsetMinutesAt,
} from './timezone.utils';

const slotsAt = (iso: string, tz: string) =>
  dueLocalSlots(new Date(iso), tz).map(
    (s) =>
      `${s.day.toISOString().slice(0, 10)} ${String(Math.floor(s.minute / 60)).padStart(2, '0')}:${String(s.minute % 60).padStart(2, '0')}`,
  );

describe('timezone utils', () => {
  it('returns the current local minute and day', () => {
    // 01:30 UTC on Wednesday is 20:30 on Tuesday in Bogota (UTC-5, no DST).
    expect(slotsAt('2026-10-28T01:30:25Z', 'America/Bogota')).toEqual([
      '2026-10-27 20:30',
    ]);
  });

  it('computes offsets that follow daylight saving time', () => {
    expect(offsetMinutesAt(new Date('2026-07-01T12:00:00Z'), 'Europe/Madrid')).toBe(120);
    expect(offsetMinutesAt(new Date('2026-12-01T12:00:00Z'), 'Europe/Madrid')).toBe(60);
    expect(offsetMinutesAt(new Date('2026-12-01T12:00:00Z'), 'America/Bogota')).toBe(-300);
  });

  it('fires the local minutes skipped when clocks go forward right after the jump', () => {
    // New York, 2026-03-08: 02:00 EST jumps to 03:00 EDT (07:00 UTC).
    expect(slotsAt('2026-03-08T06:59:00Z', 'America/New_York')).toEqual([
      '2026-03-08 01:59',
    ]);
    const atJump = slotsAt('2026-03-08T07:00:00Z', 'America/New_York');
    expect(atJump).toHaveLength(61);
    expect(atJump[0]).toBe('2026-03-08 02:00');
    expect(atJump).toContain('2026-03-08 02:30');
    expect(atJump[60]).toBe('2026-03-08 03:00');
    expect(slotsAt('2026-03-08T07:01:00Z', 'America/New_York')).toEqual([
      '2026-03-08 03:01',
    ]);
  });

  it('fires the repeated local minutes only once when clocks go back', () => {
    // New York, 2026-11-01: 02:00 EDT goes back to 01:00 EST (06:00 UTC).
    expect(slotsAt('2026-11-01T05:30:00Z', 'America/New_York')).toEqual([
      '2026-11-01 01:30',
    ]);
    expect(slotsAt('2026-11-01T06:00:00Z', 'America/New_York')).toEqual([]);
    expect(slotsAt('2026-11-01T06:30:00Z', 'America/New_York')).toEqual([]);
    expect(slotsAt('2026-11-01T06:59:00Z', 'America/New_York')).toEqual([]);
    expect(slotsAt('2026-11-01T07:00:00Z', 'America/New_York')).toEqual([
      '2026-11-01 02:00',
    ]);
  });

  it('validates IANA time zone names', () => {
    expect(isValidTimeZone('America/Bogota')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});
