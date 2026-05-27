import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { HabitsService } from './habits.service';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@UseGuards(JwtAuthGuard)
@ApiTags('habits')
@ApiBearerAuth()
@Controller('habits')
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) { }

  @Post()
  @ApiOperation({ summary: 'Crear hábito' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Fecha del hábito en formato ISO. Si no se envía, se usa la fecha actual.',
    example: '2026-05-26T00:00:00.000Z',
  })
  createHabit(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() dto: CreateHabitDto,
  ) {
    const userId = req.user.id;
    const parsedDate = dto.date ? new Date(dto.date) : undefined;
    return this.habitsService.createHabit(userId, dto, parsedDate);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener hábitos' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Fecha a consultar en formato ISO',
    example: '2026-04-03T00:00:00.000Z',
  })
  getHabits(
    @Req() req: Request & { user: AuthenticatedUser },
    @Query('date') date?: Date,
  ) {
    const userId = req.user.id;
    return this.habitsService.getHabits(userId, date);
  }

  @Post(':id/toggle')
  @ApiOperation({ summary: 'Alternar hábito' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Fecha para el entry del hábito en formato ISO. Si no se envía, se usa la fecha actual.',
  })
  toggleHabit(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('id') habitId: string,
    @Query('date') date?: string,
  ) {
    const userId = req.user.id;
    const parsedDate = date ? new Date(date) : undefined;
    return this.habitsService.toggleHabit(userId, habitId, parsedDate);
  }

  @Post(':habitId/subtasks/:sourceSubTaskId/toggle')
  @ApiOperation({ summary: 'Alternar subtarea' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Fecha para buscar/crear el entry en formato ISO. Si no se envía, se usa la fecha actual.',
  })
  toggleSubTask(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('habitId') habitId: string,
    @Param('sourceSubTaskId') sourceSubTaskId: string,
    @Query('date') date?: string,
  ) {
    const userId = req.user.id;
    const parsedDate = date ? new Date(date) : undefined;
    return this.habitsService.toggleSubTask(
      userId,
      habitId,
      sourceSubTaskId,
      parsedDate,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar hábito' })
  updateHabit(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('id') habitId: string,
    @Body() dto: UpdateHabitDto,
  ) {
    const userId = req.user.id;
    return this.habitsService.updateHabit(userId, habitId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar hábito' })
  deleteHabit(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('id') habitId: string,
  ) {
    const userId = req.user.id;
    return this.habitsService.deleteHabit(userId, habitId);
  }
}
