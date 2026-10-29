-- Reminder times are stored in the user's local time; this is the UTC offset
-- (in minutes) of the device when the reminder was saved. Existing reminders
-- were stored in UTC, so they default to 0.
ALTER TABLE "Reminder" ADD COLUMN "utcOffsetMinutes" INTEGER NOT NULL DEFAULT 0;
