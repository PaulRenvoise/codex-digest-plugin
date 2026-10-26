// First occurrence strictly after `after`, using the saved fixed UTC offset.
export function nextOccurrence(schedule, after) {
  const offset = schedule.utc_offset_minutes * 60000;
  const local = new Date(new Date(after).getTime() + offset);
  const year = local.getUTCFullYear(), month = local.getUTCMonth(), day = local.getUTCDate();
  let candidate;
  if (schedule.frequency === 'monthly') {
    const atMonth = delta => {
      const last = new Date(Date.UTC(year, month + delta + 1, 0)).getUTCDate();
      return Date.UTC(year, month + delta, Math.min(schedule.month_day, last), schedule.hour);
    };
    candidate = atMonth(0);
    if (candidate <= local.getTime()) candidate = atMonth(1);
  } else {
    const days = schedule.frequency === 'weekly' ? (schedule.weekday - local.getUTCDay() + 7) % 7 : 0;
    candidate = Date.UTC(year, month, day + days, schedule.hour);
    if (candidate <= local.getTime()) candidate += (schedule.frequency === 'weekly' ? 7 : 1) * 86400000;
  }
  return new Date(candidate - offset).toISOString();
}
