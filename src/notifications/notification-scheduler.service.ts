import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseService } from './firebase.service';
import { DevicesService } from './devices.service';
import {
  TaskFrequency,
  getSearchDateForFrequency,
  isHabitDueOnDate,
  localDayStart,
  normalizeDate,
} from '../habits/frequency.utils';
import { LocalSlot, dueLocalSlots, isValidTimeZone } from './timezone.utils';

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseService: FirebaseService,
    private readonly devicesService: DevicesService,
  ) {}

  computeCurrentMinuteUTC(now: Date): number {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  buildNotificationPayload(habit: { id: string; name: string }): {
    title: string;
    body: string;
    data: { habitId: string };
  } {
    return {
      title: 'Recordatorio',
      body: `Recordatorio: ${habit.name}`,
      data: { habitId: habit.id },
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDueReminders(): Promise<void> {
    // Guard: prevent overlapping executions
    if (this.isRunning) {
      this.logger.warn('Previous cron execution still running, skipping');
      return;
    }

    this.isRunning = true;
    try {
      await this.processDueReminders();
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Every UTC offset currently in use is a multiple of 15 minutes, between
   * UTC-12:00 and UTC+14:00.
   */
  static readonly UTC_OFFSETS: number[] = Array.from(
    { length: (840 + 720) / 15 + 1 },
    (_, i) => -720 + i * 15,
  );

  /** Local wall-clock time for a given UTC offset, expressed as a UTC Date. */
  toLocalTime(now: Date, utcOffsetMinutes: number): Date {
    return new Date(now.getTime() + utcOffsetMinutes * 60_000);
  }

  /** Local calendar day (as UTC midnight, matching how entry dates are stored). */
  localDayStart(now: Date, utcOffsetMinutes: number): Date {
    return localDayStart(now, utcOffsetMinutes);
  }

  /**
   * For every time zone in use, the local minutes due now mapped to their
   * local day (a minute skipped by a daylight saving time change is due right
   * after the change).
   */
  private async dueSlotsByTimeZone(
    now: Date,
  ): Promise<Map<string, Map<number, Date>>> {
    const rows = await this.prisma.reminder.findMany({
      where: { enabled: true, timezone: { not: null } },
      distinct: ['timezone'],
      select: { timezone: true },
    });

    const result = new Map<string, Map<number, Date>>();
    for (const { timezone } of rows) {
      if (!timezone || !isValidTimeZone(timezone)) continue;
      const slots: LocalSlot[] = dueLocalSlots(now, timezone);
      if (slots.length === 0) continue;
      result.set(timezone, new Map(slots.map((s) => [s.minute, s.day])));
    }
    return result;
  }

  private async processDueReminders(): Promise<void> {
    const now = new Date();
    const currentMinute = this.computeCurrentMinuteUTC(now);

    this.logger.debug(`Cron tick at minute ${currentMinute} (${now.toISOString()})`);

    // Reminder times are stored in the user's local time. Reminders with an
    // IANA time zone follow its daylight saving time rules; older ones only
    // have the fixed UTC offset of the device when they were saved.
    const slotsByTimeZone = await this.dueSlotsByTimeZone(now);

    const dueReminders = await this.prisma.reminder.findMany({
      where: {
        enabled: true,
        OR: [
          ...NotificationSchedulerService.UTC_OFFSETS.map((offset) => ({
            timezone: null,
            utcOffsetMinutes: offset,
            timeMinutes: this.computeCurrentMinuteUTC(
              this.toLocalTime(now, offset),
            ),
          })),
          ...[...slotsByTimeZone].map(([timezone, slots]) => ({
            timezone,
            timeMinutes: { in: [...slots.keys()] },
          })),
        ],
      },
      include: {
        habit: true,
      },
    });

    if (dueReminders.length === 0) {
      return;
    }

    this.logger.log(
      `Found ${dueReminders.length} reminder(s) matching minute ${currentMinute}`,
    );

    // "Today" is the user's local day, not the UTC day: an evening reminder in
    // UTC-5 runs after UTC midnight but still belongs to the local day.
    const todayFor = (r: {
      timeMinutes: number;
      utcOffsetMinutes?: number | null;
      timezone?: string | null;
    }) =>
      (r.timezone && slotsByTimeZone.get(r.timezone)?.get(r.timeMinutes)) ||
      this.localDayStart(now, r.utcOffsetMinutes ?? 0);

    // A WEEKLY habit is only due on the same weekday it was created; a MONTHLY habit
    // only on the same day-of-month; etc.
    const frequencyDueReminders = dueReminders.filter((r) =>
      isHabitDueOnDate(r.habit.frequency, r.habit.createdAt, todayFor(r)),
    );

    if (frequencyDueReminders.length === 0) {
      this.logger.debug(
        `No reminders are due today after frequency filtering`,
      );
      return;
    }

    this.logger.log(
      `${frequencyDueReminders.length} reminder(s) due today after frequency check`,
    );

    // Batch query for completed entries — each habit may have a different entry date
    // depending on its frequency, so we collect (habitId, entryDate) pairs and query
    // all at once using an OR condition.
    // A ONCE habit has a single period: it is done once any entry from its
    // start day on is completed, and until then it is reminded every day.
    const habitEntryFilters = frequencyDueReminders.map((r) => ({
      habitId: r.habit.id,
      date:
        r.habit.frequency === TaskFrequency.ONCE
          ? { gte: normalizeDate(r.habit.createdAt) }
          : getSearchDateForFrequency(
            r.habit.frequency,
            r.habit.createdAt,
            todayFor(r),
          ),
      completed: true as const,
    }));

    // Build a set of habitIds whose entry for *their* period date is already completed
    const completedHabitIds = new Set<string>();
    if (habitEntryFilters.length > 0) {
      // Query each (habitId, date) pair; using OR keeps it a single round-trip
      const completedEntries = await this.prisma.habitEntry.findMany({
        where: {
          OR: habitEntryFilters.map(({ habitId, date }) => ({
            habitId,
            date,
            completed: true,
          })),
        },
        select: { habitId: true },
      });
      completedEntries.forEach((e) => completedHabitIds.add(e.habitId));
    }

    // Filter out reminders for habits already completed in their current period
    const pendingReminders = frequencyDueReminders.filter(
      (r) => !completedHabitIds.has(r.habit.id),
    );

    if (pendingReminders.length === 0) {
      return;
    }

    // Group pending reminders by userId to avoid duplicate token queries
    const remindersByUser = new Map<
      string,
      Array<{ id: string; name: string }>
    >();
    for (const reminder of pendingReminders) {
      const userId = reminder.habit.userId;
      if (!remindersByUser.has(userId)) {
        remindersByUser.set(userId, []);
      }
      remindersByUser.get(userId)!.push(reminder.habit);
    }

    // Process each user's notifications
    for (const [userId, habits] of remindersByUser) {
      const deviceTokens =
        await this.devicesService.getTokensByUserId(userId);

      if (deviceTokens.length === 0) {
        this.logger.debug(`No device tokens found for user ${userId}`);
        continue;
      }

      // Build all payloads for this user's due habits
      const sendPromises: Array<Promise<void>> = [];

      for (const habit of habits) {
        const payload = this.buildNotificationPayload(habit);

        for (const deviceToken of deviceTokens) {
          // Optimization 2: Send to all tokens in parallel
          sendPromises.push(
            this.firebaseService
              .sendToDevice(deviceToken.token, payload)
              .then(async (result) => {
                if (result.success) {
                  this.logger.log(
                    `Notification sent to user ${userId} for habit "${habit.name}"`,
                  );
                } else {
                  this.logger.warn(
                    `Failed to send notification to user ${userId} for habit "${habit.name}"`,
                  );
                }
                if (result.tokenInvalid) {
                  this.logger.warn(
                    `Invalid token detected, deleting: ${deviceToken.token.substring(0, 20)}...`,
                  );
                  await this.devicesService.deleteToken(deviceToken.token);
                }
              }),
          );
        }
      }

      // Await all sends for this user concurrently
      await Promise.allSettled(sendPromises);
    }
  }
}
