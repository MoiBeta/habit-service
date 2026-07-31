import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SubTaskStateDto {
  @ApiProperty({ description: 'ID del subtask template (sourceSubTaskId)' })
  @IsString()
  @IsNotEmpty()
  sourceSubTaskId: string = '';

  @ApiProperty({ description: 'Estado de completado del subtask' })
  @IsBoolean()
  completed: boolean = false;
}

export class SyncSubtasksDto {
  @ApiProperty({
    type: () => [SubTaskStateDto],
    description: 'Lista completa de subtasks con su estado actual',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubTaskStateDto)
  subtasks: SubTaskStateDto[] = [];
}
