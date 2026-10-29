-- Reminders saved before 20261028120000_add_reminder_utc_offset store their time
-- in UTC (utcOffsetMinutes defaulted to 0). Every existing user is in Colombia
-- (America/Bogota, UTC-5 all year), so convert those times to local time and
-- attach the time zone; otherwise reminders from 19:00 local onwards keep being
-- evaluated against the next UTC day.
UPDATE "Reminder"
SET "timeMinutes" = ("timeMinutes" + 1440 - 300) % 1440,
    "utcOffsetMinutes" = -300,
    "timezone" = 'America/Bogota'
WHERE "timezone" IS NULL
  AND "utcOffsetMinutes" = 0;
