import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseService } from './firebase.service';
import { DevicesService } from './devices.service';

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

  describe('computeCurrentMinuteUTC', () => {
    it('should return 870 for 14:30 UTC', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      expect(service.computeCurrentMinuteUTC(date)).toBe(870);
    });

    it('should return 0 for midnight UTC', () => {
      const date = new Date('2024-01-15T00:00:00Z');
      expect(service.computeCurrentMinuteUTC(date)).toBe(0);
    });

    it('should return 1439 for 23:59 UTC', () => {
      const date = new Date('2024-01-15T23:59:00Z');
      expect(service.computeCurrentMinuteUTC(date)).toBe(1439);
    });
  });

  describe('buildNotificationPayload', () => {
    it('should return correct payload structure', () => {
      const habit = { id: 'habit-1', name: 'Meditar' };
      const payload = service.buildNotificationPayload(habit);

      expect(payload).toEqual({
        title: 'Recordatorio',
        body: 'Recordatorio: Meditar',
        data: { habitId: 'habit-1' },
      });
    });
  });

  describe('handleDueReminders', () => {
    it('should do nothing when no due reminders exist', async () => {
      prisma.reminder.findMany.mockResolvedValue([] as never);

      await service.handleDueReminders();

      expect(prisma.reminder.findMany).toHaveBeenCalled();
      expect(prisma.habitEntry.findMany).not.toHaveBeenCalled();
      expect(firebaseService.sendToDevice).not.toHaveBeenCalled();
    });

    it('should send notification when reminder is due and habit is not completed today', async () => {
      const dueReminders = [
        {
          id: 'reminder-1',
          habitId: 'habit-1',
          timeMinutes: 870,
          enabled: true,
          habit: { id: 'habit-1', name: 'Meditar', userId: 'user-1' },
        },
      ];
      prisma.reminder.findMany.mockResolvedValue(dueReminders as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'device-token-abc', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      expect(prisma.habitEntry.findMany).toHaveBeenCalledWith({
        where: {
          habitId: { in: ['habit-1'] },
          date: expect.any(Date),
          completed: true,
        },
        select: { habitId: true },
      });
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
      const dueReminders = [
        {
          id: 'reminder-1',
          habitId: 'habit-1',
          timeMinutes: 870,
          enabled: true,
          habit: { id: 'habit-1', name: 'Meditar', userId: 'user-1' },
        },
      ];
      prisma.reminder.findMany.mockResolvedValue(dueReminders as never);
      prisma.habitEntry.findMany.mockResolvedValue([
        { habitId: 'habit-1' },
      ] as never);

      await service.handleDueReminders();

      expect(devicesService.getTokensByUserId).not.toHaveBeenCalled();
      expect(firebaseService.sendToDevice).not.toHaveBeenCalled();
    });

    it('should delete token when FCM reports it as invalid', async () => {
      const dueReminders = [
        {
          id: 'reminder-1',
          habitId: 'habit-1',
          timeMinutes: 870,
          enabled: true,
          habit: { id: 'habit-1', name: 'Meditar', userId: 'user-1' },
        },
      ];
      prisma.reminder.findMany.mockResolvedValue(dueReminders as never);
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
      // Simulate a long-running execution
      prisma.reminder.findMany.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([] as never), 100)),
      );

      // Start first execution (will take 100ms)
      const first = service.handleDueReminders();

      // Try second execution immediately — should be skipped
      await service.handleDueReminders();

      await first;

      // findMany should only have been called once (second call was skipped)
      expect(prisma.reminder.findMany).toHaveBeenCalledTimes(1);
    });

    it('should send notifications to multiple tokens in parallel', async () => {
      const dueReminders = [
        {
          id: 'reminder-1',
          habitId: 'habit-1',
          timeMinutes: 870,
          enabled: true,
          habit: { id: 'habit-1', name: 'Meditar', userId: 'user-1' },
        },
      ];
      prisma.reminder.findMany.mockResolvedValue(dueReminders as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'token-1', userId: 'user-1', platform: 'android' },
        { id: 'dt-2', token: 'token-2', userId: 'user-1', platform: 'ios' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      // Both tokens should have been called
      expect(firebaseService.sendToDevice).toHaveBeenCalledTimes(2);
      expect(firebaseService.sendToDevice).toHaveBeenCalledWith(
        'token-1',
        expect.any(Object),
      );
      expect(firebaseService.sendToDevice).toHaveBeenCalledWith(
        'token-2',
        expect.any(Object),
      );
    });

    it('should query device tokens only once per user with multiple habits', async () => {
      const dueReminders = [
        {
          id: 'reminder-1',
          habitId: 'habit-1',
          timeMinutes: 870,
          enabled: true,
          habit: { id: 'habit-1', name: 'Meditar', userId: 'user-1' },
        },
        {
          id: 'reminder-2',
          habitId: 'habit-2',
          timeMinutes: 870,
          enabled: true,
          habit: { id: 'habit-2', name: 'Ejercicio', userId: 'user-1' },
        },
      ];
      prisma.reminder.findMany.mockResolvedValue(dueReminders as never);
      prisma.habitEntry.findMany.mockResolvedValue([] as never);
      devicesService.getTokensByUserId.mockResolvedValue([
        { id: 'dt-1', token: 'token-1', userId: 'user-1', platform: 'android' },
      ] as never);
      firebaseService.sendToDevice.mockResolvedValue({ success: true } as never);

      await service.handleDueReminders();

      // Device tokens queried only once for user-1
      expect(devicesService.getTokensByUserId).toHaveBeenCalledTimes(1);
      expect(devicesService.getTokensByUserId).toHaveBeenCalledWith('user-1');

      // But notifications sent for both habits
      expect(firebaseService.sendToDevice).toHaveBeenCalledTimes(2);
    });
  });
});
