import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseService } from './firebase.service';
import { DevicesService } from './devices.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a Date at midnight UTC for the given ISO date string */
function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Builds a minimal reminder mock.
 * `createdAt` defaults to the same weekday/date as `now` so DAILY/WEEKLY habits
 * are always "due today" in tests unless overridden.
 */
function makeReminder(overrides: {
  id?: string;
  habitId?: string;
  timeMinutes?: number;
  utcOffsetMinutes?: number;
  timezone?: string | null;
  frequency?: string;
  createdAt?: Date;
  userId?: string;
  habitName?: string;
}) {
  const {
    id = 'reminder-1',
    habitId = 'habit-1',
    timeMinutes = 870,
    utcOffsetMinutes = 0,
    timezone = null,
    frequency = 'DAILY',
    createdAt = new Date(), // same day → always due
    userId = 'user-1',
    habitName = 'Meditar',
  } = overrides;

  return {
    id,
    habitId,
    timeMinutes,
    utcOffsetMinutes,
    timezone,
    enabled: true,
    habit: {
      id: habitId,
      name: habitName,
      userId,
      frequency,
      createdAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationSchedulerService', () => {
  let service: NotificationSchedulerService;
  let prisma: {
    reminder: { findMany: jest.Mock };
    habitEntry: { findMany: jest.Mock };
  };
  let firebaseService: { sendToDevice: jest.Mock };
  let devicesService: { getTokensByUserId: jest.Mock; deleteToken: jest.Mock };

  beforeEach(() => {
    prisma = {
      reminder: { findMany: jest.fn() },
      habitEntry: { findMany: jest.fn() },
    };
    firebaseService = { sendToDevice: jest.fn() };
    devicesService = {
      getTokensByUserId: jest.fn(),
      deleteToken: jest.fn(),
    };

    service = new NotificationSchedulerService(
      prisma as unknown as PrismaService,
      firebaseService as unknown as FirebaseService,
      devicesService as unknown as DevicesService,
    );
  });

  // -------------------------------------------------------------------------
  // Pure utility methods
  // -------------------------------------------------------------------------

  describe('computeCurrentMinuteUTC', () => {
    it('should return 870 for 14:30 UTC', () => {
      expect(service.computeCurrentMinuteUTC(new Date('2024-01-15T14:30:00Z'))).toBe(870);
    });

    it('should return 0 for midnight UTC', () => {
      expect(service.computeCurrentMinuteUTC(new Date('2024-01-15T00:00:00Z'))).toBe(0);
    });

    it('should return 1439 for 23:59 UTC', () => {
      expect(service.computeCurrentMinuteUTC(new Date('2024-01-15T23:59:00Z'))).toBe(1439);
    });
  });

  describe('buildNotificationPayload', () => {
    it('should return correct payload structure', () => {
      const habit = { id: 'habit-1', name: 'Meditar' };
      expect(service.buildNotificationPayload(habit)).toEqual({
        title: 'Recordatorio',
        body: 'Recordatorio: Meditar',
        data: { habitId: 'habit-1' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // handleDueReminders — general flow
  // -------------------------------------------------------------------------

  describe('handleDueReminders', () => {
    it('should do nothing when no due reminders exist', async () => {
      prisma.reminder.findMany.mockResolvedValue([] as never);

      await service.handleDueReminders();

      expect(prisma.reminder.findMany).toHaveBeenCalled();
      expect(prisma.habitEntry.findMany).not.toHaveBeenCalled();
      expect(firebaseService.sendToDevice).not.toHaveBeenCalled();
    });

    it('should send notification when reminder is due and habit is not completed today', async () => {
      // DAILY habit — createdAt doesn't affect due-day logic
      const reminder = makeReminder({ frequency: 'DAILY', createdAt: utcDay('2024-01-01') });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'device-token-abc', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      expect(prisma.habitEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) }),
        }),
      );
      expect(devicesService.getTokensByUserId).toHaveBeenCalledWith('user-1');
      expect(firebaseService.sendToDevice).toHaveBeenCalledWith(
        'device-token-abc',
        {
          title: 'Recordatorio',
          body: 'Recordatorio: Meditar',
          data: { habitId: 'habit-1' },
        },
      );
    });

    it('should skip notification when habit is already completed today', async () => {
      const reminder = makeReminder({ frequency: 'DAILY', createdAt: utcDay('2024-01-01') });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([{ habitId: 'habit-1' }] as never);

      await service.handleDueReminders();

      expect(devicesService.getTokensByUserId).not.toHaveBeenCalled();
      expect(firebaseService.sendToDevice).not.toHaveBeenCalled();
    });

    it('should delete token when FCM reports it as invalid', async () => {
      const reminder = makeReminder({ frequency: 'DAILY', createdAt: utcDay('2024-01-01') });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'invalid-token', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({
        success: false,
        tokenInvalid: true,
      } as never);

      await service.handleDueReminders();

      expect(devicesService.deleteToken).toHaveBeenCalledWith('invalid-token');
    });

    it('should skip execution when previous cron is still running', async () => {
      prisma.reminder.findMany.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([] as never), 100)),
      );

      const first = service.handleDueReminders();
      await service.handleDueReminders(); // should be skipped
      await first;

      // Only the first run queries: time zones in use + due reminders.
      expect(prisma.reminder.findMany).toHaveBeenCalledTimes(2);
    });

    it('should send notifications to multiple tokens in parallel', async () => {
      const reminder = makeReminder({ frequency: 'DAILY', createdAt: utcDay('2024-01-01') });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'token-1', userId: 'user-1', platform: 'android' },
        { id: 'dt-2', token: 'token-2', userId: 'user-1', platform: 'ios' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      expect(firebaseService.sendToDevice).toHaveBeenCalledTimes(2);
      expect(firebaseService.sendToDevice).toHaveBeenCalledWith('token-1', expect.any(Object));
      expect(firebaseService.sendToDevice).toHaveBeenCalledWith('token-2', expect.any(Object));
    });

    it('should query device tokens only once per user with multiple habits', async () => {
      const reminders = [
        makeReminder({ id: 'r-1', habitId: 'habit-1', habitName: 'Meditar', frequency: 'DAILY', createdAt: utcDay('2024-01-01') }),
        makeReminder({ id: 'r-2', habitId: 'habit-2', habitName: 'Ejercicio', frequency: 'DAILY', createdAt: utcDay('2024-01-01') }),
      ];
      prisma.reminder.findMany.mockResolvedValue(reminders as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'token-1', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      expect(devicesService.getTokensByUserId).toHaveBeenCalledTimes(1);
      expect(devicesService.getTokensByUserId).toHaveBeenCalledWith('user-1');
      expect(firebaseService.sendToDevice).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Frequency filtering — the core bug fix
  // -------------------------------------------------------------------------

  describe('IANA time zones', () => {
    it('uses the local day of the reminder time zone for WEEKLY habits', async () => {
      // Tuesday 20:00 in New York (EDT, UTC-4) is Wednesday 00:00 UTC.
      jest.useFakeTimers().setSystemTime(new Date('2026-10-28T00:00:00Z'));

      const reminder = makeReminder({
        frequency: 'WEEKLY',
        createdAt: utcDay('2026-10-20'), // a Tuesday
        timeMinutes: 20 * 60,
        timezone: 'America/New_York',
      });
      prisma.reminder.findMany
        .mockResolvedValueOnce([{ timezone: 'America/New_York' }] as never)
        .mockResolvedValueOnce([reminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'token-tz', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      const query = (prisma.reminder.findMany.mock.calls[1][0] as any).where.OR;
      expect(query).toContainEqual({
        timezone: 'America/New_York',
        timeMinutes: { in: [20 * 60] },
      });
      expect(firebaseService.sendToDevice).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });

  describe('Frequency filtering', () => {
    /**
     * A WEEKLY habit created on a Monday should fire ONLY on Mondays.
     * We simulate "today is Tuesday" → the reminder should be suppressed.
     */
    it('should NOT send notification for a WEEKLY habit on a non-matching weekday', async () => {
      // Monday 2024-01-15
      const createdAt = utcDay('2024-01-15'); // Monday
      // Today is Tuesday 2024-01-16 — NOT the habit's weekday
      jest
        .useFakeTimers()
        .setSystemTime(new Date('2024-01-16T14:30:00Z')); // Tuesday

      const reminder = makeReminder({
        frequency: 'WEEKLY',
        createdAt,
      });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);

      await service.handleDueReminders();

      expect(prisma.habitEntry.findMany).not.toHaveBeenCalled();
      expect(firebaseService.sendToDevice).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    /**
     * The same WEEKLY habit should fire on the correct weekday (Monday).
     */
    it('should send notification for a WEEKLY habit on the correct weekday', async () => {
      // Habit created on Monday 2024-01-15
      const createdAt = utcDay('2024-01-15'); // Monday
      // Today is Monday 2024-01-22 — same weekday
      jest
        .useFakeTimers()
        .setSystemTime(new Date('2024-01-22T14:30:00Z')); // Monday

      const reminder = makeReminder({
        frequency: 'WEEKLY',
        createdAt,
      });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'token-weekly', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      expect(firebaseService.sendToDevice).toHaveBeenCalledTimes(1);
      expect(firebaseService.sendToDevice).toHaveBeenCalledWith(
        'token-weekly',
        expect.objectContaining({ title: 'Recordatorio' }),
      );

      jest.useRealTimers();
    });

    /**
     * A MONTHLY habit created on the 15th should only fire on the 15th of each month.
     */
    it('should NOT send notification for a MONTHLY habit on a non-matching day-of-month', async () => {
      const createdAt = utcDay('2024-01-15'); // created on the 15th
      // Today is the 16th
      jest.useFakeTimers().setSystemTime(new Date('2024-02-16T08:00:00Z'));

      const reminder = makeReminder({ frequency: 'MONTHLY', createdAt });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);

      await service.handleDueReminders();

      expect(firebaseService.sendToDevice).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should send notification for a MONTHLY habit on the correct day-of-month', async () => {
      const createdAt = utcDay('2024-01-15'); // created on the 15th
      // Today is the 15th of the following month
      jest.useFakeTimers().setSystemTime(new Date('2024-02-15T08:00:00Z'));

      const reminder = makeReminder({ frequency: 'MONTHLY', createdAt });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'token-monthly', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      expect(firebaseService.sendToDevice).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    /**
     * Mixed: one DAILY (always due) and one WEEKLY (not due today) at the same minute.
     * Only the DAILY should fire.
     */
    it('should send notification only to DAILY habit when WEEKLY is not due today', async () => {
      // Monday
      const weeklyCreatedAt = utcDay('2024-01-15'); // Monday
      // Today is Tuesday — WEEKLY is NOT due; DAILY is always due
      jest.useFakeTimers().setSystemTime(new Date('2024-01-16T14:30:00Z'));

      const dailyReminder = makeReminder({
        id: 'r-daily',
        habitId: 'habit-daily',
        habitName: 'Diario',
        frequency: 'DAILY',
        createdAt: utcDay('2024-01-16'), // any date works for DAILY
      });
      const weeklyReminder = makeReminder({
        id: 'r-weekly',
        habitId: 'habit-weekly',
        habitName: 'Semanal',
        frequency: 'WEEKLY',
        createdAt: weeklyCreatedAt,
      });

      prisma.reminder.findMany.mockResolvedValue([dailyReminder, weeklyReminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'token-user', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      // Only 1 notification — for the DAILY habit
      expect(firebaseService.sendToDevice).toHaveBeenCalledTimes(1);
      expect(firebaseService.sendToDevice).toHaveBeenCalledWith(
        'token-user',
        expect.objectContaining({ data: { habitId: 'habit-daily' } }),
      );

      jest.useRealTimers();
    });

    /**
     * WEEKLY habit completed for the current week — should NOT receive a second notification.
     * The completed-entry check must use the habit's entry date (week period), not raw todayStart.
     */
    it('should skip WEEKLY habit already completed this week', async () => {
      // Monday 2024-01-22 — both createdAt and "today"
      const createdAt = utcDay('2024-01-15'); // Monday
      jest.useFakeTimers().setSystemTime(new Date('2024-01-22T14:30:00Z')); // Monday

      const reminder = makeReminder({
        frequency: 'WEEKLY',
        createdAt,
      });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);
      // Return completed entry for this Monday's date
      prisma.habitEntry.findMany.mockResolvedValue([{ habitId: 'habit-1' }] as never);

      await service.handleDueReminders();

      expect(firebaseService.sendToDevice).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('Local timezone handling', () => {
    it('matches reminders by local time for each UTC offset', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-28T01:00:00Z'));
      prisma.reminder.findMany.mockResolvedValue([] as never);

      await service.handleDueReminders();

      // calls[0] lists the time zones in use; calls[1] finds due reminders.
      const where = (prisma.reminder.findMany.mock.calls[1][0] as any).where;
      // 01:00 UTC is 20:00 (1200) in UTC-5 and 01:00 (60) in UTC.
      expect(where.OR).toContainEqual({ timezone: null, utcOffsetMinutes: -300, timeMinutes: 1200 });
      expect(where.OR).toContainEqual({ timezone: null, utcOffsetMinutes: 0, timeMinutes: 60 });
      jest.useRealTimers();
    });

    it("checks completion against the user's local day, not the UTC day", async () => {
      // 20:00 on Oct 27 in UTC-5 == 01:00 on Oct 28 UTC
      jest.useFakeTimers().setSystemTime(new Date('2026-10-28T01:00:00Z'));
      const reminder = makeReminder({
        timeMinutes: 1200,
        utcOffsetMinutes: -300,
        createdAt: utcDay('2026-10-01'),
      });
      prisma.reminder.findMany.mockResolvedValue([reminder] as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([] as never);

      await service.handleDueReminders();

      const where = (prisma.habitEntry.findMany.mock.calls[0][0] as any).where;
      expect(where.OR[0].date.toISOString()).toBe('2026-10-27T00:00:00.000Z');
      jest.useRealTimers();
    });
  });
});
