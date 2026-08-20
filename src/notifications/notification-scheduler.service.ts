import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseService } from './firebase.service';
import { DevicesService } from './devices.service';

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

    // Get today's date at midnight UTC for HabitEntry comparison
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
      `Found ${dueReminders.length} due reminder(s) at minute ${currentMinute}`,
    );

    // Optimization 1: Batch query for completed habits (eliminates N+1)
    const habitIds = dueReminders.map((r) => r.habit.id);
    const completedEntries = await this.prisma.habitEntry.findMany({
      where: {
        habitId: { in: habitIds },
        date: todayStart,
        completed: true,
      },
      select: { habitId: true },
    });
    const completedHabitIds = new Set(
      completedEntries.map((entry) => entry.habitId),
    );

    // Filter out reminders for habits already completed today
    const pendingReminders = dueReminders.filter(
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
                if (result.tokenInvalid) {
                  this.logger.warn(
                    `Invalid token detected, deleting: ${deviceToken.token}`,
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
