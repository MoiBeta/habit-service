-- IANA time zone of the device (e.g. America/Bogota). When set, the reminder
-- follows that zone's daylight saving time rules instead of utcOffsetMinutes.
ALTER TABLE "Reminder" ADD COLUMN "timezone" TEXT;
