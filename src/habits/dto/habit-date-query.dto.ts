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

  @ApiPropertyOptional({
    example: '2026-04-03',
    description:
      'Día actual del usuario (YYYY-MM-DD). Las tareas de una sola vez pendientes se muestran solo en ese día. Si no se envía, se usa el día actual en UTC.',
  })
  @IsOptional()
  @IsDateString()
  today?: string;
}
