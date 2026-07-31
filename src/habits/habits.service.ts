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
    
    // La fecha de creación es ahora, o la especificada
    const creationDate = date ? new Date(date) : new Date();

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
    const entryDate = this.getSearchDateForFrequency(
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
    const targetDate = date
      ? this.normalizeDate(new Date(date))
      : this.normalizeDate(new Date());

    const habits = (await this.prisma.habit.findMany({
      where: { userId },
      include: {
        entries: {
          include: { subTasks: true },
        },
        subTasks: true,
        reminders: true,
      },
      orderBy: {
        priority: 'asc',
      },
    })) as any[];

    const habitsDue = habits.filter((habit) =>
      this.isHabitDueOnTargetDate(habit.frequency, habit.createdAt, targetDate),
    );

    return habitsDue.map((habit) => {
      // Obtener la entry correcta según la frecuencia
      const entry = this.getEntryForFrequency(
        habit.entries,
        habit.frequency,
        habit.createdAt,
        targetDate,
      );

      // Calcular la fecha que debe mostrar según la frecuencia
      const displayDate = this.getDisplayDateForFrequency(
        habit.frequency,
        habit.createdAt,
        targetDate,
      );

      const entryForResponse = entry ?? {
        id: '',
        date: displayDate,
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
    const targetDate = date
      ? this.normalizeDate(new Date(date))
      : this.normalizeDate(new Date());

    await this.validateOwnership(userId, habitId);

    const habit = (await this.prisma.habit.findUnique({
      where: { id: habitId },
      include: { subTasks: true },
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
    const searchDate = this.getSearchDateForFrequency(
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
      updatedEntry = await this.prisma.habitEntry.create({
        data: {
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
      include: { subTasks: true },
    })) as any;

    if (!habit) {
      throw new NotFoundException('Habit not found');
    }

    const targetDate = date
      ? this.normalizeDate(new Date(date))
      : this.normalizeDate(new Date());

    const searchDate = this.getSearchDateForFrequency(
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

  async updateHabit(userId: string, habitId: string, dto: UpdateHabitDto) {
    await this.validateOwnership(userId, habitId);

    const habitData: {
      name?: string;
      description?: string | null;
      priority?: number;
      frequency?: string;
    } = {
      name: dto.name,
      description: dto.description,
      priority: dto.priority,
      frequency: dto.frequency,
    };

    const updated = (await this.prisma.habit.update({
      where: { id: habitId },
      data: habitData,
      include: {
        subTasks: true,
        reminders: true,
      },
    })) as any;

    if (dto.subTasks !== undefined) {
      await this.prisma.subTask.deleteMany({
        where: { habitId },
      });

      if (dto.subTasks.length > 0) {
        await this.prisma.subTask.createMany({
          data: this.buildSubTaskCreateData(dto.subTasks).map((subtask) => ({
            habitId,
            title: subtask.title,
            orderId: subtask.orderId,
          })),
        });
      }
    }

    if (dto.reminder !== undefined) {
      const existingReminder = await this.prisma.reminder.findFirst({
        where: { habitId },
      });

      if (existingReminder) {
        await this.prisma.reminder.update({
          where: { id: existingReminder.id },
          data: {
            timeMinutes: dto.reminder.timeMinutes,
            enabled: dto.reminder.enabled ?? true,
          },
        });
      } else {
        await this.prisma.reminder.create({
          data: {
            habitId,
            timeMinutes: dto.reminder.timeMinutes,
            enabled: dto.reminder.enabled ?? true,
          },
        });
      }
    }

    const finalHabit = await this.prisma.habit.findUniqueOrThrow({
      where: { id: habitId },
      include: {
        subTasks: true,
        reminders: true,
      },
    }) as any;

    return this.mapHabitToResponse(finalHabit);
  }

  async deleteHabit(userId: string, habitId: string) {
    await this.validateOwnership(userId, habitId);

    return this.prisma.habit.delete({
      where: { id: habitId },
    });
  }

  private getSearchDateForFrequency(
    frequency: string,
    habitCreatedAt: Date,
    targetDate: Date,
  ): Date {
    switch (frequency) {
      case TaskFrequency.WEEKLY:
        return this.getDateWithSameDayOfWeek(habitCreatedAt, targetDate);
      case TaskFrequency.MONTHLY:
        return this.getDateWithSameDayOfMonth(habitCreatedAt, targetDate);
      case TaskFrequency.YEARLY:
        return this.getDateWithSameDayAndMonth(habitCreatedAt, targetDate);
      case TaskFrequency.DAILY:
      default:
        return this.normalizeDate(targetDate);
    }
  }

  /**
   * Obtiene la fecha a mostrar en la respuesta según la frecuencia
   */
  private getDisplayDateForFrequency(
    frequency: string,
    habitCreatedAt: Date,
    targetDate: Date,
  ): Date {
    return this.getSearchDateForFrequency(frequency, habitCreatedAt, targetDate);
  }

  /**
   * Obtiene la entrada correcta de entre la lista según la frecuencia
   */
  private getEntryForFrequency(
    entries: any[],
    frequency: string,
    habitCreatedAt: Date,
    targetDate: Date,
  ): any {
    if (entries.length === 0) {
      return null;
    }

    const searchDate = this.getSearchDateForFrequency(
      frequency,
      habitCreatedAt,
      targetDate,
    );

    // Buscar por fecha exacta
    return entries.find((e) => 
      e.date.getTime() === searchDate.getTime()
    );
  }

  private isHabitDueOnTargetDate(
    frequency: string,
    habitCreatedAt: Date,
    targetDate: Date,
  ): boolean {
    const searchDate = this.getSearchDateForFrequency(
      frequency,
      habitCreatedAt,
      targetDate,
    );

    return searchDate.getTime() === targetDate.getTime();
  }

  /**
   * Calcula la fecha más cercana con el mismo día de la semana
   * Ej: habitCreatedAt es martes, targetDate es viernes -> devuelve el martes de esa semana/próxima semana más cercana
   */
  private getDateWithSameDayOfWeek(
    habitCreatedAt: Date,
    targetDate: Date,
  ): Date {
    const createdDayOfWeek = habitCreatedAt.getUTCDay();
    const targetDayOfWeek = targetDate.getUTCDay();
    
    const daysToAdd = createdDayOfWeek - targetDayOfWeek;
    
    const result = new Date(targetDate);
    result.setUTCDate(result.getUTCDate() + daysToAdd);
    result.setUTCHours(0, 0, 0, 0);
    
    return result;
  }

  /**
   * Calcula la fecha del mismo día del mes
   * Ej: habitCreatedAt es 25 de febrero, targetDate es 5 de marzo -> devuelve 25 de marzo
   */
  private getDateWithSameDayOfMonth(
    habitCreatedAt: Date,
    targetDate: Date,
  ): Date {
    const createdDay = habitCreatedAt.getUTCDate();
    const result = new Date(targetDate);
    
    result.setUTCDate(createdDay);
    result.setUTCHours(0, 0, 0, 0);
    
    return result;
  }

  /**
   * Calcula la fecha del mismo día y mes del año
   * Ej: habitCreatedAt es 25 de febrero, targetDate es 15 de julio -> devuelve 25 de febrero del año de targetDate
   */
  private getDateWithSameDayAndMonth(
    habitCreatedAt: Date,
    targetDate: Date,
  ): Date {
    const createdDay = habitCreatedAt.getUTCDate();
    const createdMonth = habitCreatedAt.getUTCMonth();
    
    const result = new Date(targetDate);
    result.setUTCMonth(createdMonth);
    result.setUTCDate(createdDay);
    result.setUTCHours(0, 0, 0, 0);
    
    return result;
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
    };
  }

  normalizeDate(date: Date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}

