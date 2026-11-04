function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function agendaPdfPath(day: Date): string {
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  return `/api/calendar/agenda-pdf?date=${date}`;
}
