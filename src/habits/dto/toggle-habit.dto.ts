import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class ToggleHabitDto {
  @ApiPropertyOptional({
    example: '2026-04-04T00:00:00.000Z',
    description: 'Fecha objetivo del habito en formato ISO',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
