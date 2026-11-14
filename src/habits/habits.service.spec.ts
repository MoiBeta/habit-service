import { describe, expect, it, jest } from '@jest/globals';
import { HabitsService } from './habits.service';

describe('HabitsService', () => {
  it('maps subtasks with a sourceSubTaskId fallback when the source is missing', () => {
    const service = new HabitsService({} as any, {} as any);

    const response = (service as any).mapHabitToResponse(
      {
        id: 'habit-1',
        userId: 'user-1',
        name: 'Test habit',
        description: null,
        frequency: 'DAILY',
        priority: 100,
        subTasks: [{ id: 'sub-1', title: 'Subtask', completed: false }],
      },
      {
        id: 'entry-1',
        date: new Date('2026-01-01T00:00:00.000Z'),
        completed: false,
        completedAt: null,
        subTasks: [{ id: 'entry-sub-1', title: 'Subtask', completed: false }],
      },
    );

    expect(response.subtasks[0].sourceSubTaskId).toBe('entry-sub-1');
  });

  it('returns only the active reminder', () => {
    const service = new HabitsService({} as any, {} as any);
    const habit = {
      id: 'habit-1',
      userId: 'user-1',
      name: 'Test habit',
      frequency: 'DAILY',
      priority: 100,
      subTasks: [],
    };

    const withReminder = (service as any).mapHabitToResponse({
      ...habit,
      reminders: [{ timeMinutes: 1215, utcOffsetMinutes: -300, enabled: true }],
    });
    expect(withReminder.reminder).toEqual({
      timeMinutes: 1215,
      utcOffsetMinutes: -300,
    });

    const disabled = (service as any).mapHabitToResponse({
      ...habit,
      reminders: [{ timeMinutes: 1215, utcOffsetMinutes: -300, enabled: false }],
    });
    expect(disabled.reminder).toBeNull();
  });

  describe('ONCE habits', () => {
    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const habit = {
      id: 'once-1',
      userId: 'user-1',
      name: 'Renovar pasaporte',
      frequency: 'ONCE',
      priority: 100,
      createdAt: day('2026-11-10'),
      subTasks: [],
      reminders: [],
    };

    function setup(entries: any[], habitOverrides: Record<string, unknown> = {}) {
      const stored = { ...habit, ...habitOverrides };
      const prisma = {
        habit: {
          findMany: jest.fn().mockResolvedValue([stored] as never),
          findFirst: jest.fn().mockResolvedValue(stored as never),
          findUnique: jest.fn().mockResolvedValue(stored as never),
          update: jest.fn(),
        },
        habitEntry: {
          findMany: jest.fn().mockResolvedValue(entries as never),
          findUnique: jest.fn(),
          update: jest.fn((args: any) =>
            Promise.resolve({ ...entries[0], ...args.data, subTasks: [] }),
          ),
          upsert: jest.fn((args: any) =>
            Promise.resolve({ id: 'new', ...args.create, subTasks: [] }),
          ),
          deleteMany: jest.fn(),
        },
      };
      return { prisma, service: new HabitsService(prisma as any, {} as any) };
    }

    const idsOn = async (service: HabitsService, date: string, today: string) =>
      (await service.getHabits('user-1', day(date), day(today))).map((h) => h.id);

    it('a pending task is shown only on the current day', async () => {
      const { service } = setup([
        { id: 'e1', habitId: 'once-1', date: day('2026-11-10'), completed: false, subTasks: [] },
      ]);

      expect(await idsOn(service, '2026-11-12', '2026-11-12')).toEqual(['once-1']);
      // Not on the days it was left undone, nor on the days to come.
      expect(await idsOn(service, '2026-11-10', '2026-11-12')).toEqual([]);
      expect(await idsOn(service, '2026-11-11', '2026-11-12')).toEqual([]);
      expect(await idsOn(service, '2026-11-13', '2026-11-12')).toEqual([]);
    });

    it('a pending task is returned with the day it is shown on', async () => {
      const { service } = setup([
        { id: 'e1', habitId: 'once-1', date: day('2026-11-10'), completed: false, subTasks: [] },
      ]);

      const [task] = await service.getHabits('user-1', day('2026-11-12'), day('2026-11-12'));
      expect(task.startDate).toEqual(day('2026-11-12'));
      expect(task.completed).toBe(false);
    });

    it('a completed task is shown only on the day it was completed', async () => {
      const { service } = setup([
        { id: 'e1', habitId: 'once-1', date: day('2026-11-11'), completed: true, subTasks: [] },
      ]);

      expect(await idsOn(service, '2026-11-11', '2026-11-12')).toEqual(['once-1']);
      expect(await idsOn(service, '2026-11-12', '2026-11-12')).toEqual([]);
      expect(await idsOn(service, '2026-11-13', '2026-11-14')).toEqual([]);
    });

    it('a task that starts on a later day is shown on that day', async () => {
      const { service } = setup([]);

      expect(await idsOn(service, '2026-11-10', '2026-11-08')).toEqual(['once-1']);
      expect(await idsOn(service, '2026-11-08', '2026-11-08')).toEqual([]);
    });

    it('completing it moves its entry to the day it was completed on', async () => {
      const { service, prisma } = setup([
        { id: 'e1', habitId: 'once-1', date: day('2026-11-10'), completed: false, subTasks: [] },
      ]);

      const result = await service.toggleHabit('user-1', 'once-1', day('2026-11-12'));

      expect(prisma.habitEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: expect.objectContaining({ completed: true, date: day('2026-11-12') }),
        }),
      );
      expect(result.completed).toBe(true);
      expect(result.startDate).toEqual(day('2026-11-12'));
    });

    it('undoing the completion leaves it pending again', async () => {
      const { service, prisma } = setup([
        { id: 'e1', habitId: 'once-1', date: day('2026-11-11'), completed: true, subTasks: [] },
      ]);

      await service.toggleHabit('user-1', 'once-1', day('2026-11-11'));

      const data = (prisma.habitEntry.update.mock.calls[0][0] as any).data;
      expect(data).toEqual({ completed: false, completedAt: null });
    });

    it('completing a task without an entry creates it on that day', async () => {
      const { service, prisma } = setup([]);

      await service.toggleHabit('user-1', 'once-1', day('2026-11-12'));

      expect((prisma.habitEntry.upsert.mock.calls[0][0] as any).create).toEqual(
        expect.objectContaining({ date: day('2026-11-12'), completed: true }),
      );
    });
  });
});
