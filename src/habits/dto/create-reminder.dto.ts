import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class CreateReminderDto {
  @ApiProperty({
    example: 480,
    description: 'Hora del recordatorio en minutos desde medianoche',
  })
  @IsNumber()
  timeMinutes: number; // Ejemplo: 480 para 08:00 (8*60)

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Indica si el recordatorio esta activo',
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean = true;
}
