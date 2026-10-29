import { SubTaskResponseDto } from './subtask.response.dto';

export { TaskFrequency } from '../frequency.utils';
import { TaskFrequency } from '../frequency.utils';

export class ReminderResponseDto {
    timeMinutes!: number; // local time, minutes since midnight
    utcOffsetMinutes!: number;
}

export class HabitResponseDto {
    id!: string;
    userId!: string;
    title!: string;
    description?: string;
    startDate!: Date; // date of the entry being returned (the viewed period)
    habitStartDate!: Date; // day the habit starts; weekly/monthly/yearly repeat on it
    subtasks?: SubTaskResponseDto[];
    completed!: boolean;
    completedAt?: Date;
    templateId!: string;
    instanceId!: string;
    taskFrequency!: TaskFrequency;
    priority!: number;
    reminder!: ReminderResponseDto | null; // null when there is no active reminder
}
