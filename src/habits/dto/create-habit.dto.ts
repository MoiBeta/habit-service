import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { CreateReminderDto } from './create-reminder.dto';
import { CreateSubTaskDto } from './create-sub-task.dto';
import { TaskFrequency } from './habit.response.dto';

export class CreateHabitDto {
  @ApiProperty({
    example: 'Ejercicio diario',
    maxLength: 100,
    description: 'Nombre del habito',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string = '';

  @ApiPropertyOptional({
    example: 'Hacer ejercicio por 30 minutos',
    maxLength: 255,
    description: 'Descripcion opcional del habito',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    example: 100,
    description: 'Prioridad de ordenamiento del habito',
  })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiPropertyOptional({
    enum: TaskFrequency,
    example: TaskFrequency.DAILY,
    description: 'Frecuencia del habito: DAILY, WEEKLY, MONTHLY, YEARLY',
  })
  @IsOptional()
  @IsEnum(TaskFrequency)
  frequency?: TaskFrequency = TaskFrequency.DAILY;

  @ApiPropertyOptional({
    type: () => [CreateSubTaskDto],
    description: 'Lista opcional de subtareas del habito',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSubTaskDto)
  subTasks?: CreateSubTaskDto[];

  @ApiPropertyOptional({
    type: () => CreateReminderDto,
    description: 'Configuracion opcional de recordatorio',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateReminderDto)
  reminder?: CreateReminderDto;

  @ApiPropertyOptional({
    example: '2026-05-26T00:00:00.000Z',
    description: 'Fecha ISO para crear el entry que indica desde cuándo comenzar a mostrar el hábito',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
