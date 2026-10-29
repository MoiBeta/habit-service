import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { RegisterTokenDto } from './dto/register-token.dto';
import { UnregisterTokenDto } from './dto/unregister-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@UseGuards(JwtAuthGuard)
@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('token')
  @ApiOperation({ summary: 'Registrar token FCM del dispositivo' })
  async registerToken(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() dto: RegisterTokenDto,
  ): Promise<{ success: boolean }> {
    const userId = req.user.id;
    await this.devicesService.upsertToken(userId, dto.token, dto.platform);
    return { success: true };
  }

  @Delete('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar token FCM del dispositivo (logout)' })
  async unregisterToken(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() dto: UnregisterTokenDto,
  ): Promise<{ success: boolean }> {
    await this.devicesService.deleteUserToken(req.user.id, dto.token);
    return { success: true };
  }
}
