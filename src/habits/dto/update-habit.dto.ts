import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateHabitDto } from './create-habit.dto';

export class UpdateHabitDto extends PartialType(
  OmitType(CreateHabitDto, ['subTasks', 'reminder']),
) {}
