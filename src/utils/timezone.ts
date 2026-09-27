/**
 * Timezone utilities for HighP SaaS
 * Guarantees proper day-boundary and date-string handling for company timezones (default Asia/Kolkata).
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns "YYYY-MM-DD" string for a Date in the given timezone.
 */
export const getDateStringInTimezone = (
  date: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE
): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

/**
 * Returns UTC Date objects for the start and end of a specific date in the given timezone.
 */
export const getDayRangeInTimezone = (
  dateStr: string, // "YYYY-MM-DD"
  timeZone: string = DEFAULT_TIMEZONE
): { start: Date; end: Date } => {
  const tz = timeZone || DEFAULT_TIMEZONE;
  try {
    // For Asia/Kolkata (+05:30)
    if (tz === 'Asia/Kolkata' || tz === 'IST') {
      const start = new Date(`${dateStr}T00:00:00.000+05:30`);
      const end = new Date(`${dateStr}T23:59:59.999+05:30`);
      return { start, end };
    }

    // Generic timezone calculation
    const dummyUtc = new Date(`${dateStr}T12:00:00.000Z`);
    const dateFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    }).format(dummyUtc);

    // Extract offset like "GMT+5:30" or "GMT-4"
    const match = dateFormatted.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (match) {
      const sign = match[1].startsWith('-') ? '-' : '+';
      const hours = Math.abs(parseInt(match[1], 10)).toString().padStart(2, '0');
      const mins = (match[2] || '00').padStart(2, '0');
      const offsetStr = `${sign}${hours}:${mins}`;
      return {
        start: new Date(`${dateStr}T00:00:00.000${offsetStr}`),
        end: new Date(`${dateStr}T23:59:59.999${offsetStr}`)
      };
    }
  } catch (err) {
    console.warn(`[Timezone] Error resolving range for tz ${tz}:`, err);
  }

  // Fallback to UTC
  return {
    start: new Date(`${dateStr}T00:00:00.000Z`),
    end: new Date(`${dateStr}T23:59:59.999Z`)
  };
};
