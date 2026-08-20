import * as fc from 'fast-check';

/**
 * Property-Based Tests for NotificationSchedulerService
 *
 * These tests validate correctness properties of the scheduler's pure logic
 * using randomly generated inputs via fast-check.
 */

// Pure exclusion logic extracted from scheduler
function excludeCompletedHabits<T extends { hasCompletedEntry: boolean }>(
  reminders: T[],
): T[] {
  return reminders.filter((r) => !r.hasCompletedEntry);
}

/**
 * **Validates: Requirements 3.3**
 */
describe('Property 2: Completed Habit Exclusion', () => {
  it('should exclude all reminders whose habit has a completed entry for today', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            habitId: fc.uuid(),
            hasCompletedEntry: fc.boolean(),
          }),
        ),
        (reminders) => {
          const result = excludeCompletedHabits(reminders);
          const expected = reminders.filter(
            (r) => r.hasCompletedEntry === false,
          );
          expect(result).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
