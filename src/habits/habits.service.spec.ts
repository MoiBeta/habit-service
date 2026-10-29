import { describe, expect, it } from '@jest/globals';
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
});
