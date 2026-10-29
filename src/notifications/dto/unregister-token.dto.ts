import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UnregisterTokenDto {
  @ApiProperty({
    example: 'fMl9Xs...device-token',
    description: 'Token FCM del dispositivo',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
