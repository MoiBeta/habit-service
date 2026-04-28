import { SubTaskResponseDto } from './subtask.response.dto';

export enum TaskFrequency {
    NONE = 'NONE',
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    MONTHLY = 'MONTHLY',
    YEARLY = 'YEARLY',
    CUSTOM = 'CUSTOM',
}

export class HabitResponseDto {
    id!: string;
    userId!: string;
    title!: string;
    description?: string;
    startDate!: Date;
    subtasks?: SubTaskResponseDto[];
    completed!: boolean;
    completedAt?: Date;
    templateId!: string;
    instanceId!: string;
    taskFrequency!: TaskFrequency;
    priority!: number;
}
