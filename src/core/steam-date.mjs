export function parseSteamPostedAt(value, now = new Date()) {
  if (!value) return now;
  const normalized = value.replace(',', '').replace(/\s+/g, ' ').trim();
  const match = parseMonthDay(normalized) || parseDayMonth(normalized);
  if (!match) return now;

  const { month, day, year, hour, minute, ampm } = match;
  let normalizedHour = hour;
  if (ampm === 'pm' && normalizedHour !== 12) normalizedHour += 12;
  if (ampm === 'am' && normalizedHour === 12) normalizedHour = 0;

  const parsed = new Date(year ?? now.getFullYear(), month, day, normalizedHour, minute, 0);
  if (year == null && parsed.getTime() - now.getTime() > 1000 * 60 * 60 * 24 * 30) {
    parsed.setFullYear(parsed.getFullYear() - 1);
  }
  return parsed;
}

function parseMonthDay(value) {
  const withYear = value.match(/^([A-Za-z]{3,9}) (\d{1,2}) (\d{4}) @ (\d{1,2}):(\d{2})(am|pm)$/i);
  const withoutYear = value.match(/^([A-Za-z]{3,9}) (\d{1,2}) @ (\d{1,2}):(\d{2})(am|pm)$/i);
  const match = withYear || withoutYear;
  if (!match) return null;

  const month = monthIndex(match[1]);
  if (month < 0) return null;
  const hasYear = match.length === 7;
  const hourIndex = hasYear ? 4 : 3;
  return {
    month,
    day: Number(match[2]),
    year: hasYear ? Number(match[3]) : null,
    hour: Number(match[hourIndex]),
    minute: Number(match[hourIndex + 1]),
    ampm: match[hourIndex + 2].toLowerCase(),
  };
}

function parseDayMonth(value) {
  const withYear = value.match(/^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4}) @ (\d{1,2}):(\d{2})(am|pm)$/i);
  const withoutYear = value.match(/^(\d{1,2}) ([A-Za-z]{3,9}) @ (\d{1,2}):(\d{2})(am|pm)$/i);
  const match = withYear || withoutYear;
  if (!match) return null;

  const month = monthIndex(match[2]);
  if (month < 0) return null;
  const hasYear = match.length === 7;
  const hourIndex = hasYear ? 4 : 3;
  return {
    month,
    day: Number(match[1]),
    year: hasYear ? Number(match[3]) : null,
    hour: Number(match[hourIndex]),
    minute: Number(match[hourIndex + 1]),
    ampm: match[hourIndex + 2].toLowerCase(),
  };
}

function monthIndex(name) {
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
    name.slice(0, 3).toLowerCase(),
  );
}
