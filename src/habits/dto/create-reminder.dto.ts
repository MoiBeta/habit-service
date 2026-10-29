import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsTimeZone,
  Max,
  Min,
} from 'class-validator';

export class CreateReminderDto {
  @ApiProperty({
    example: 480,
    description: 'Hora local del recordatorio en minutos desde medianoche',
  })
  @IsNumber()
  @Min(0)
  @Max(1439)
  timeMinutes: number; // Ejemplo: 480 para 08:00 (8*60)

  @ApiPropertyOptional({
    example: -300,
    default: 0,
    description:
      'Desfase UTC del dispositivo en minutos (p. ej. -300 para UTC-5). Si se omite, timeMinutes se interpreta en UTC.',
  })
  @IsOptional()
  @IsInt()
  @Min(-720)
  @Max(840)
  utcOffsetMinutes?: number;

  @ApiPropertyOptional({
    example: 'America/Bogota',
    description:
      'Zona horaria IANA del dispositivo. Si se envía, el recordatorio sigue los cambios de horario de verano de esa zona.',
  })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Indica si el recordatorio esta activo',
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean = true;
}
