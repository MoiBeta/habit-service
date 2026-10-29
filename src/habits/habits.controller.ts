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
import { SyncSubtasksDto } from './dto/sync-subtasks.dto';
import { HabitDateQueryDto } from './dto/habit-date-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@UseGuards(JwtAuthGuard)
@ApiTags('habits')
@ApiBearerAuth()
@Controller('habits')
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) { }

  @Post()
  @ApiOperation({ summary: 'Crear hábito' })
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
  getHabits(
    @Req() req: Request & { user: AuthenticatedUser },
    @Query() query: HabitDateQueryDto,
  ) {
    const userId = req.user.id;
    const parsedDate = query.date ? new Date(query.date) : undefined;
    return this.habitsService.getHabits(userId, parsedDate);
  }

  @Post(':id/toggle')
  @ApiOperation({ summary: 'Alternar hábito' })
  toggleHabit(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('id') habitId: string,
    @Query() query: HabitDateQueryDto,
  ) {
    const userId = req.user.id;
    const parsedDate = query.date ? new Date(query.date) : undefined;
    return this.habitsService.toggleHabit(userId, habitId, parsedDate);
  }

  @Post(':habitId/subtasks/sync')
  @ApiOperation({ summary: 'Sincronizar estado de subtareas' })
  syncSubtasks(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('habitId') habitId: string,
    @Body() dto: SyncSubtasksDto,
    @Query() query: HabitDateQueryDto,
  ) {
    const userId = req.user.id;
    const parsedDate = query.date ? new Date(query.date) : undefined;
    return this.habitsService.syncSubtasks(userId, habitId, dto, parsedDate);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar hábito' })
  updateHabit(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('id') habitId: string,
    @Body() dto: UpdateHabitDto,
    @Query() query: HabitDateQueryDto,
  ) {
    const userId = req.user.id;
    const parsedDate = query.date ? new Date(query.date) : undefined;
    return this.habitsService.updateHabit(userId, habitId, dto, parsedDate);
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
