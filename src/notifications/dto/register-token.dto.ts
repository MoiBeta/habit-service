import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RegisterTokenDto {
  @ApiProperty({
    example: 'fMl9Xs...device-token',
    description: 'Token FCM del dispositivo',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'android',
    description: 'Plataforma del dispositivo (android, ios, web)',
  })
  @IsString()
  @IsNotEmpty()
  platform: string;
}
