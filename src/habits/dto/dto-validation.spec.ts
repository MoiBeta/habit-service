import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateHabitDto } from './update-habit.dto';
import { HabitDateQueryDto } from './habit-date-query.dto';
import { CreateHabitDto } from './create-habit.dto';

describe('DTO validation', () => {
  it('UpdateHabitDto accepts a partial body and does not default the frequency', () => {
    const dto = plainToInstance(UpdateHabitDto, { priority: 250 });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.frequency).toBeUndefined();
    expect(dto.name).toBeUndefined();
  });

  it('CreateHabitDto still requires a name', () => {
    const dto = plainToInstance(CreateHabitDto, {});
    expect(validateSync(dto).map((e) => e.property)).toContain('name');
  });

  it('HabitDateQueryDto rejects invalid dates', () => {
    expect(validateSync(plainToInstance(HabitDateQueryDto, { date: 'abc' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(HabitDateQueryDto, { date: '2026-04-03' }))).toHaveLength(0);
  });

  it('rejects unsupported frequencies such as NONE', () => {
    const dto = plainToInstance(CreateHabitDto, { name: 'x', frequency: 'NONE' });
    expect(validateSync(dto).map((e) => e.property)).toContain('frequency');
  });

  it('accepts the ONCE frequency', () => {
    const dto = plainToInstance(CreateHabitDto, { name: 'x', frequency: 'ONCE' });
    expect(validateSync(dto)).toHaveLength(0);
  });
});
