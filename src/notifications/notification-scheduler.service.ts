import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseService } from './firebase.service';
import { DevicesService } from './devices.service';
import {
  getSearchDateForFrequency,
  isHabitDueOnDate,
} from '../habits/frequency.utils';

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

  private async processDueReminders(): Promise<void> {
    const now = new Date();
    const currentMinute = this.computeCurrentMinuteUTC(now);

    this.logger.debug(`Cron tick at minute ${currentMinute} (${now.toISOString()})`);

    // Today at midnight UTC — used for due-date checks
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    // Query enabled reminders where timeMinutes matches currentMinute, including the habit
    const dueReminders = await this.prisma.reminder.findMany({
      where: {
        timeMinutes: currentMinute,
        enabled: true,
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

    // --- FIX: filter out habits that are not due today based on their frequency ---
    // A WEEKLY habit is only due on the same weekday it was created; a MONTHLY habit
    // only on the same day-of-month; etc.  Without this check every reminder was firing
    // every day regardless of frequency.
    const frequencyDueReminders = dueReminders.filter((r) =>
      isHabitDueOnDate(r.habit.frequency, r.habit.createdAt, todayStart),
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
    const habitEntryFilters = frequencyDueReminders.map((r) => ({
      habitId: r.habit.id,
      date: getSearchDateForFrequency(
        r.habit.frequency,
        r.habit.createdAt,
        todayStart,
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
