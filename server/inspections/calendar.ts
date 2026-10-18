export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function addDays(day: string, n: number) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function isDue(
  start: string,
  end: string,
  frequency: string,
  day: string,
) {
  if (day < start || day > end) return false;
  if (frequency === 'once') return day === start;
  if (frequency === 'daily') return true;
  const from = new Date(start + 'T00:00:00Z'),
    to = new Date(day + 'T00:00:00Z');
  if (frequency === 'weekly') return from.getUTCDay() === to.getUTCDay();
  const last = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return to.getUTCDate() === Math.min(from.getUTCDate(), last);
}
export function dispatchWindow(
  cursor: string,
  start: string,
  end: string,
  until: string,
  maxDays = 31,
) {
  let d = cursor ? addDays(cursor, 1) : start;
  const days: string[] = [];
  while (d <= end && d <= until && days.length < maxDays) {
    days.push(d);
    d = addDays(d, 1);
  }
  return days;
}
