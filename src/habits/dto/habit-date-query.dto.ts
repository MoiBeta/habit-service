import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class HabitDateQueryDto {
  @ApiPropertyOptional({
    example: '2026-04-03',
    description:
      'Fecha en formato ISO (YYYY-MM-DD o fecha-hora). Si no se envía, se usa la fecha actual.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
