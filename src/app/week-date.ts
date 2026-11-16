function dateToKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getCalendarWeekStart(today: Date): Date {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = date.getDay();
  date.setDate(date.getDate() - ((day + 6) % 7));
  return date;
}

export function getShoppingWeekStart(today = new Date()): string {
  const date = getCalendarWeekStart(today);
  if (today.getDay() === 0 || today.getDay() === 6) date.setDate(date.getDate() + 7);
  return dateToKey(date);
}

export function getOfferMenuWeekStart(today = new Date()): string {
  const date = getCalendarWeekStart(today);
  date.setDate(date.getDate() + 7);
  return dateToKey(date);
}
