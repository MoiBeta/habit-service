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
  TaskFrequency,
} from './dto/habit.response.dto';
import { SubTaskResponseDto } from './dto/subtask.response.dto';

@Injectable()
export class HabitsService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) { }

  async createHabit(userId: string, dto: CreateHabitDto) {
    await this.usersService.validateUser(userId);

    let priority = dto.priority;
    if (priority === undefined) {
      const maxPriority = await this.prisma.habit.aggregate({
        where: { userId },
        _max: { priority: true },
      });
      priority = (maxPriority._max.priority || 0) + 100;
    }

    const habit = await this.prisma.habit.create({
      data: {
        name: dto.name,
        description: dto.description,
        priority,
        userId,
        subTasks: dto.subTasks
          ? {
            create: dto.subTasks.map((sub) => ({ title: sub.title })),
          }
          : undefined,
        reminders: dto.reminder
          ? {
            create: {
              timeMinutes: dto.reminder.timeMinutes,
              enabled: dto.reminder.enabled ?? true,
            },
          }
          : undefined,
      },
      include: {
        subTasks: true,
        reminders: true,
      },
    });

    const today = this.normalizeDate(new Date());
    const entry = await this.prisma.habitEntry.create({
      data: {
        habitId: habit.id,
        date: today,
        completed: false,
        subTasks: habit.subTasks.length > 0
          ? {
            create: habit.subTasks.map((st) => ({
              title: st.title,
              completed: false,
              sourceSubTaskId: st.id,
            })),
          }
          : undefined,
      },
      include: { subTasks: true },
    });

    return this.mapHabitToResponse(habit, entry);
  }

  async getHabits(userId: string, date?: Date): Promise<HabitResponseDto[]> {
    const targetDate = date
      ? this.normalizeDate(date)
      : this.normalizeDate(new Date());

    const habits = await this.prisma.habit.findMany({
      where: { userId },
      include: {
        entries: {
          where: { date: targetDate },
          include: { subTasks: true },
        },
        subTasks: true,
        reminders: true,
      },
      orderBy: {
        priority: 'asc',
      },
    });

    return habits.map((habit) => {
      const entry = habit.entries[0];
      return this.mapHabitToResponse(habit, entry);
    });
  }

  async toggleHabit(
    userId: string,
    habitId: string,
    date?: Date,
  ): Promise<HabitResponseDto> {
    const targetDate = date
      ? this.normalizeDate(date)
      : this.normalizeDate(new Date());

    await this.validateOwnership(userId, habitId);

    const habit = await this.prisma.habit.findUnique({
      where: { id: habitId },
      include: { subTasks: true },
    });

    if (!habit) {
      throw new NotFoundException();
    }

    if (habit.subTasks.length > 0) {
      throw new BadRequestException(
        'This habit has subtasks. Toggle its subtasks instead.',
      );
    }

    const existingEntry = await this.prisma.habitEntry.findUnique({
      where: { habitId_date: { habitId, date: targetDate } },
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
      updatedEntry = await this.prisma.habitEntry.create({
        data: {
          habitId,
          date: targetDate,
          completed: true,
          completedAt: new Date(),
        },
        include: { subTasks: true },
      });
    }

    return this.mapHabitToResponse(habit, updatedEntry);
  }

  async toggleSubTask(
    userId: string,
    habitId: string,
    subtaskId: string,
    entryId?: string,
  ): Promise<HabitResponseDto> {
    await this.validateOwnership(userId, habitId);

    const habit = await this.prisma.habit.findUnique({
      where: { id: habitId },
      include: { subTasks: true },
    });

    if (!habit) {
      throw new NotFoundException('Habit not found');
    }

    if (habit.subTasks.length === 0) {
      throw new BadRequestException(
        'This habit has no subtasks. Use toggleHabit instead.',
      );
    }

    const sourceSubTask = habit.subTasks.find(
      (subtask) => subtask.id === subtaskId,
    );
    if (!sourceSubTask) {
      throw new NotFoundException('Subtask not found in this habit');
    }

    let entry;

    if (entryId) {
      entry = await this.prisma.habitEntry.findFirst({
        where: { id: entryId, habitId },
        include: { subTasks: true },
      });

      if (!entry) {
        throw new NotFoundException('Habit entry not found');
      }
    } else {
      const today = this.normalizeDate(new Date());

      entry = await this.prisma.habitEntry.findUnique({
        where: { habitId_date: { habitId, date: today } },
        include: { subTasks: true },
      });

      if (!entry) {
        entry = await this.prisma.habitEntry.create({
          data: {
            habitId,
            date: today,
            completed: false,
            subTasks: {
              create: habit.subTasks.map((subtask) => ({
                title: subtask.title,
                completed: false,
                sourceSubTaskId: subtask.id,
              })),
            },
          },
          include: { subTasks: true },
        });
      }
    }

    const entrySubTask =
      entry.subTasks.find((subtask) => subtask.sourceSubTaskId === subtaskId) ??
      entry.subTasks.find(
        (subtask) =>
          !subtask.sourceSubTaskId && subtask.title === sourceSubTask.title,
      );

    if (!entrySubTask) {
      throw new NotFoundException('Subtask not found in this entry');
    }

    await this.prisma.entrySubTask.update({
      where: { id: entrySubTask.id },
      data: {
        completed: !entrySubTask.completed,
        sourceSubTaskId: entrySubTask.sourceSubTaskId ?? sourceSubTask.id,
      },
    });

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

  async updateHabit(userId: string, habitId: string, dto: UpdateHabitDto) {
    await this.validateOwnership(userId, habitId);

    const updated = await this.prisma.habit.update({
      where: { id: habitId },
      data: {
        name: dto.name,
        description: dto.description,
        priority: dto.priority,
      },
      include: { subTasks: true },
    });

    return this.mapHabitToResponse(updated);
  }

  async deleteHabit(userId: string, habitId: string) {
    await this.validateOwnership(userId, habitId);

    return this.prisma.habit.delete({
      where: { id: habitId },
    });
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

  private mapHabitToResponse(
    habit: any,
    entry?: any,
  ): HabitResponseDto {
    return {
      id: habit.id,
      userId: habit.userId,
      title: habit.name,
      description: habit.description,
      startDate: entry?.date || new Date(),
      subtasks: entry?.subTasks
        ? entry.subTasks.map((st: any) => {
          const subtask = new SubTaskResponseDto();
          subtask.id = st.id;
          subtask.title = st.title;
          subtask.completed = st.completed;
          return subtask;
        })
        : [],
      completed: entry?.completed || false,
      completedAt: entry?.completedAt,
      templateId: habit.id,
      instanceId: entry?.id || '',
      taskFrequency: TaskFrequency.DAILY, // Valor por defecto
      priority: habit.priority,
    };
  }

  normalizeDate(date: Date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
