import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSubTaskDto {
  @ApiProperty({
    example: 'Calentamiento',
    maxLength: 100,
    description: 'Titulo de la subtarea',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;
}
