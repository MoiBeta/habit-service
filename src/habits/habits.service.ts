import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { CreateHabitDto } from './dto/create-habit.dto';
import {
  HabitResponseDto,
  ReminderResponseDto,
} from './dto/habit.response.dto';
import { SubTaskResponseDto } from './dto/subtask.response.dto';
import {
  TaskFrequency,
  getSearchDateForFrequency,
  isHabitDueOnDate,
  localDayStart,
  normalizeDate,
} from './frequency.utils';
import { offsetMinutesAt } from '../notifications/timezone.utils';

@Injectable()
export class HabitsService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) { }

  async createHabit(userId: string, dto: CreateHabitDto, date?: Date) {
    await this.usersService.validateUser(userId);

    let priority = dto.priority;
    if (priority === undefined) {
      const maxPriority = await this.prisma.habit.aggregate({
        where: { userId },
        _max: { priority: true },
      });
      priority = (maxPriority._max.priority || 0) + 100;
    }

    const frequency = dto.frequency || TaskFrequency.DAILY;
    
    // createdAt is the day the habit starts (UTC midnight of the user's local
    // day): weekly/monthly/yearly habits repeat on that day. Without an
    // explicit date, use the local day of the reminder's time zone; storing the
    // current instant would move evening habits to the next UTC day.
    const now = new Date();
    const creationDate = date
      ? normalizeDate(date)
      : localDayStart(
        now,
        dto.reminder?.timezone
          ? offsetMinutesAt(now, dto.reminder.timezone)
          : (dto.reminder?.utcOffsetMinutes ?? 0),
      );

    const habit = await this.prisma.habit.create({
      data: {
        name: dto.name,
        description: dto.description,
        priority,
        frequency,
        userId,
        createdAt: creationDate,
        subTasks: dto.subTasks && dto.subTasks.length > 0
          ? {
            create: this.buildSubTaskCreateData(dto.subTasks),
          }
          : undefined,
        reminders: dto.reminder
          ? {
            create: {
              timeMinutes: dto.reminder.timeMinutes,
              utcOffsetMinutes: dto.reminder.utcOffsetMinutes ?? 0,
              timezone: dto.reminder.timezone,
              enabled: dto.reminder.enabled ?? true,
            },
          }
          : undefined,
      },
      include: {
        subTasks: true,
        reminders: true,
      },
    }) as any;

    // Crear la entry inicial con la fecha calculada según la frecuencia
    const entryDate = getSearchDateForFrequency(
      frequency,
      creationDate,
      creationDate,
    );
    
    const entry = await this.prisma.habitEntry.create({
      data: {
        habitId: habit.id,
        date: entryDate,
        completed: false,
        subTasks: habit.subTasks.length > 0
          ? {
            create: habit.subTasks.map((st, index) => ({
              title: st.title,
              completed: false,
              sourceSubTaskId: st.id,
              orderId: this.getSubTaskOrderId(st as any, index),
            })),
          }
          : undefined,
      },
      include: { subTasks: true },
    });

    return this.mapHabitToResponse(habit, entry);
  }

  async getHabits(userId: string, date?: Date): Promise<HabitResponseDto[]> {
    const targetDate = normalizeDate(date ?? new Date());

    const habits = (await this.prisma.habit.findMany({
      where: { userId },
      include: {
        subTasks: true,
        reminders: true,
      },
      orderBy: {
        priority: 'asc',
      },
    })) as any[];

    const habitsDue = habits
      .filter((habit) =>
        isHabitDueOnDate(habit.frequency, habit.createdAt, targetDate),
      )
      .map((habit) => ({
        habit,
        searchDate: getSearchDateForFrequency(
          habit.frequency,
          habit.createdAt,
          targetDate,
        ),
      }));

    // Only load the entry of the current period for each due habit instead of
    // the whole history.
    const entries =
      habitsDue.length > 0
        ? await this.prisma.habitEntry.findMany({
          where: {
            OR: habitsDue.map(({ habit, searchDate }) => ({
              habitId: habit.id,
              date: searchDate,
            })),
          },
          include: { subTasks: true },
        })
        : [];
    const entryByHabitId = new Map(entries.map((e) => [e.habitId, e]));

    return habitsDue.map(({ habit, searchDate }) => {
      const entryForResponse = entryByHabitId.get(habit.id) ?? {
        id: '',
        date: searchDate,
        completed: false,
        completedAt: null,
        subTasks: this.sortSubTasks(habit.subTasks).map((st: any) => ({
          id: st.id,
          title: st.title,
          completed: false,
          sourceSubTaskId: st.id,
          orderId: this.getSubTaskOrderId(st, 0),
        })),
      };

      return this.mapHabitToResponse(habit, entryForResponse);
    });
  }

  async toggleHabit(
    userId: string,
    habitId: string,
    date?: Date,
  ): Promise<HabitResponseDto> {
    const targetDate = normalizeDate(date ?? new Date());

    await this.validateOwnership(userId, habitId);

    const habit = (await this.prisma.habit.findUnique({
      where: { id: habitId },
      include: { subTasks: true, reminders: true },
    })) as any;

    if (!habit) {
      throw new NotFoundException();
    }

    if (habit.subTasks.length > 0) {
      throw new BadRequestException(
        'This habit has subtasks. Toggle its subtasks instead.',
      );
    }

    // Obtener la fecha de búsqueda/creación según la frecuencia
    const searchDate = getSearchDateForFrequency(
      habit.frequency,
      habit.createdAt,
      targetDate,
    );

    const existingEntry = await this.prisma.habitEntry.findUnique({
      where: { habitId_date: { habitId, date: searchDate } },
      include: { subTasks: true },
    });

    let updatedEntry;

    if (existingEntry) {
      const nextCompleted = !existingEntry.completed;

      updatedEntry = await this.prisma.habitEntry.update({
        where: { id: existingEntry.id },
        data: {
          completed: nextCompleted,
          completedAt: nextCompleted ? new Date() : null,
        },
        include: { subTasks: true },
      });
    } else {
      updatedEntry = await this.prisma.habitEntry.upsert({
        where: { habitId_date: { habitId, date: searchDate } },
        update: {
          completed: true,
          completedAt: new Date(),
        },
        create: {
          habitId,
          date: searchDate,
          completed: true,
          completedAt: new Date(),
        },
        include: { subTasks: true },
      });
    }

    return this.mapHabitToResponse(habit, updatedEntry);
  }

  async syncSubtasks(
    userId: string,
    habitId: string,
    dto: { subtasks: Array<{ sourceSubTaskId: string; completed: boolean }> },
    date?: Date,
  ): Promise<HabitResponseDto> {
    await this.validateOwnership(userId, habitId);

    const habit = (await this.prisma.habit.findUnique({
      where: { id: habitId },
      include: { subTasks: true, reminders: true },
    })) as any;

    if (!habit) {
      throw new NotFoundException('Habit not found');
    }

    const targetDate = normalizeDate(date ?? new Date());

    const searchDate = getSearchDateForFrequency(
      habit.frequency,
      habit.createdAt,
      targetDate,
    );

    // Find or create the entry for this date
    let entry = await this.prisma.habitEntry.findUnique({
      where: { habitId_date: { habitId, date: searchDate } },
      include: { subTasks: true },
    });

    if (!entry) {
      entry = await this.prisma.habitEntry.create({
        data: {
          habitId,
          date: searchDate,
          completed: false,
          subTasks: {
            create: habit.subTasks.map((subtask: any, index: number) => ({
              title: subtask.title,
              completed: false,
              sourceSubTaskId: subtask.id,
              orderId: this.getSubTaskOrderId(subtask as any, index),
            })),
          },
        },
        include: { subTasks: true },
      });
    }

    // Update each entry subtask based on the provided state
    for (const subtaskState of dto.subtasks) {
      const entrySubTask = entry.subTasks.find(
        (es) => es.sourceSubTaskId === subtaskState.sourceSubTaskId,
      );

      if (entrySubTask) {
        await this.prisma.entrySubTask.update({
          where: { id: entrySubTask.id },
          data: { completed: subtaskState.completed },
        });
      } else {
        // EntrySubTask doesn't exist yet, create it
        const sourceSubTask = habit.subTasks.find(
          (st: any) => st.id === subtaskState.sourceSubTaskId,
        );
        if (sourceSubTask) {
          await this.prisma.entrySubTask.create({
            data: {
              entryId: entry.id,
              title: sourceSubTask.title,
              completed: subtaskState.completed,
              sourceSubTaskId: sourceSubTask.id,
              orderId: this.getSubTaskOrderId(sourceSubTask as any, 0),
            },
          });
        }
      }
    }

    // Recalculate completion status
    const updatedSubTasks = await this.prisma.entrySubTask.findMany({
      where: { entryId: entry.id },
    });

    const allCompleted =
      updatedSubTasks.length > 0 &&
      updatedSubTasks.every((subtask) => subtask.completed);

    const updatedEntry = await this.prisma.habitEntry.update({
      where: { id: entry.id },
      data: {
        completed: allCompleted,
        completedAt: allCompleted ? new Date() : null,
      },
      include: { subTasks: true },
    });

    return this.mapHabitToResponse(habit, updatedEntry);
  }

  async updateHabit(
    userId: string,
    habitId: string,
    dto: UpdateHabitDto,
    date?: Date,
  ) {
    await this.validateOwnership(userId, habitId);

    const targetDate = normalizeDate(date ?? new Date());

    const finalHabit = await this.prisma.$transaction(async (tx) => {
      const habit = await tx.habit.update({
        where: { id: habitId },
        data: {
          name: dto.name,
          description: dto.description,
          priority: dto.priority,
          frequency: dto.frequency,
          // The habit's start day (see createHabit).
          createdAt: dto.date ? normalizeDate(new Date(dto.date)) : undefined,
        },
      });

      if (dto.subTasks !== undefined) {
        await tx.subTask.deleteMany({ where: { habitId } });

        const newSubTasks = await tx.subTask.createManyAndReturn({
          data: this.buildSubTaskCreateData(dto.subTasks).map((subtask) => ({
            habitId,
            title: subtask.title,
            orderId: subtask.orderId,
          })),
        });

        // The entry of the current period still points to the old template
        // subtasks; rebuild it keeping the completion state by title.
        // Past entries are historical snapshots and are left untouched.
        const searchDate = getSearchDateForFrequency(
          habit.frequency,
          habit.createdAt,
          targetDate,
        );
        const entry = await tx.habitEntry.findUnique({
          where: { habitId_date: { habitId, date: searchDate } },
          include: { subTasks: true },
        });

        if (entry) {
          const completedTitles = new Set(
            entry.subTasks.filter((st) => st.completed).map((st) => st.title),
          );
          await tx.entrySubTask.deleteMany({ where: { entryId: entry.id } });
          await tx.entrySubTask.createMany({
            data: newSubTasks.map((st, index) => ({
              entryId: entry.id,
              title: st.title,
              completed: completedTitles.has(st.title),
              sourceSubTaskId: st.id,
              orderId: this.getSubTaskOrderId(st, index),
            })),
          });

          if (newSubTasks.length > 0) {
            const allCompleted = newSubTasks.every((st) =>
              completedTitles.has(st.title),
            );
            await tx.habitEntry.update({
              where: { id: entry.id },
              data: {
                completed: allCompleted,
                completedAt: allCompleted
                  ? (entry.completedAt ?? new Date())
                  : null,
              },
            });
          }
        }
      }

      if (dto.reminder !== undefined) {
        const existingReminder = await tx.reminder.findFirst({
          where: { habitId },
        });

        if (existingReminder) {
          await tx.reminder.update({
            where: { id: existingReminder.id },
            data: {
              timeMinutes: dto.reminder.timeMinutes,
              utcOffsetMinutes: dto.reminder.utcOffsetMinutes ?? 0,
              timezone: dto.reminder.timezone,
              enabled: dto.reminder.enabled ?? true,
            },
          });
        } else {
          await tx.reminder.create({
            data: {
              habitId,
              timeMinutes: dto.reminder.timeMinutes,
              utcOffsetMinutes: dto.reminder.utcOffsetMinutes ?? 0,
              timezone: dto.reminder.timezone,
              enabled: dto.reminder.enabled ?? true,
            },
          });
        }
      }

      return tx.habit.findUniqueOrThrow({
        where: { id: habitId },
        include: {
          subTasks: true,
          reminders: true,
        },
      });
    });

    const entry = await this.prisma.habitEntry.findUnique({
      where: {
        habitId_date: {
          habitId,
          date: getSearchDateForFrequency(
            finalHabit.frequency,
            finalHabit.createdAt,
            targetDate,
          ),
        },
      },
      include: { subTasks: true },
    });

    return this.mapHabitToResponse(finalHabit, entry ?? undefined);
  }

  async deleteHabit(userId: string, habitId: string) {
    await this.validateOwnership(userId, habitId);

    return this.prisma.habit.delete({
      where: { id: habitId },
    });
  }

  private buildSubTaskCreateData(subTasks: Array<{ title: string; orderId?: number | null }>) {
    return subTasks.map((subtask, index) => ({
      title: subtask.title,
      orderId: subtask.orderId ?? index,
    }));
  }

  private async validateOwnership(userId: string, habitId: string) {
    const habit = await this.prisma.habit.findFirst({
      where: { id: habitId, userId },
    });

    if (!habit) {
      throw new ForbiddenException();
    }

    return habit;
  }

  private getSubTaskOrderId(subTask: { orderId?: number | null } | undefined, fallbackIndex: number) {
    return subTask?.orderId ?? fallbackIndex;
  }

  private sortSubTasks<T extends Record<string, any>>(subTasks: T[]) {
    return [...subTasks].sort(
      (a, b) => this.getSubTaskOrderId(a as { orderId?: number | null }, 0) - this.getSubTaskOrderId(b as { orderId?: number | null }, 0),
    );
  }

  private mapHabitToResponse(
    habit: any,
    entry?: any,
  ): HabitResponseDto {
    const useEntrySubTasks = entry?.subTasks?.length > 0;
    const subtasksSource = this.sortSubTasks(
      useEntrySubTasks ? entry.subTasks : habit.subTasks,
    );

    return {
      id: habit.id,
      userId: habit.userId,
      title: habit.name,
      description: habit.description,
      startDate: entry?.date || new Date(),
      habitStartDate: habit.createdAt,
      subtasks: subtasksSource
        ? subtasksSource.map((st: any) => {
          const subtask = new SubTaskResponseDto();
          subtask.id = st.id;
          subtask.title = st.title;
          subtask.completed = st.completed ?? false;
          // When subtasks come from the template (habit.subTasks), st.id IS the sourceSubTaskId.
          // When they come from an entry (EntrySubTask), sourceSubTaskId is an explicit field.
          subtask.sourceSubTaskId = useEntrySubTasks
            ? (st.sourceSubTaskId ?? st.id)
            : st.id;
          return subtask;
        })
        : [],
      completed: entry?.completed || false,
      completedAt: entry?.completedAt,
      templateId: habit.id,
      instanceId: entry?.id || '',
      taskFrequency: habit.frequency as TaskFrequency,
      priority: habit.priority,
      reminder: this.mapReminder(habit.reminders),
    };
  }

  private mapReminder(reminders?: any[]): ReminderResponseDto | null {
    const reminder = reminders?.find((r) => r.enabled);
    return reminder
      ? {
        timeMinutes: reminder.timeMinutes,
        utcOffsetMinutes: reminder.utcOffsetMinutes,
      }
      : null;
  }
}

