import { PartialType } from '@nestjs/swagger';
import { CreateHabitDto } from './create-habit.dto';

// All fields optional: fields that are not sent keep their current value.
export class UpdateHabitDto extends PartialType(CreateHabitDto) {}
