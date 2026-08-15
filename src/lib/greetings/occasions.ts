// The occasions an agency is offered greetings for. Fixed-date
// occasions recur via `monthDay`; lunar-calendar festivals shift every
// year, so those carry explicit verified dates per year — a year with
// no entry simply doesn't surface in "upcoming" (the occasion stays
// selectable for a manual compose, and any occasion can be typed free-
// form as a custom one). Extend `dates` as future years are confirmed.

export interface Occasion {
  id: string;
  label: string;
  emoji: string;
  monthDay?: string;
  dates?: Record<number, string>;
}

export interface UpcomingOccasion {
  occasion: Occasion;
  date: Date;
}

export const OCCASIONS: Occasion[] = [
  { id: 'new_year', label: 'New Year', emoji: '🎉', monthDay: '01-01' },
  {
    id: 'makar_sankranti',
    label: 'Makar Sankranti / Pongal',
    emoji: '🪁',
    monthDay: '01-14',
  },
  { id: 'republic_day', label: 'Republic Day', emoji: '🇮🇳', monthDay: '01-26' },
  { id: 'holi', label: 'Holi', emoji: '🎨', dates: { 2026: '2026-03-04' } },
  {
    id: 'ugadi',
    label: 'Ugadi / Gudi Padwa',
    emoji: '🌸',
    dates: { 2026: '2026-03-19' },
  },
  {
    id: 'eid_al_fitr',
    label: 'Eid al-Fitr',
    emoji: '🌙',
    dates: { 2026: '2026-03-20' },
  },
  {
    id: 'independence_day',
    label: 'Independence Day',
    emoji: '🇮🇳',
    monthDay: '08-15',
  },
  {
    id: 'onam',
    label: 'Onam',
    emoji: '🌼',
    dates: { 2026: '2026-08-26', 2027: '2027-09-12' },
  },
  {
    id: 'raksha_bandhan',
    label: 'Raksha Bandhan',
    emoji: '🎀',
    dates: { 2026: '2026-08-28' },
  },
  {
    id: 'ganesh_chaturthi',
    label: 'Ganesh Chaturthi',
    emoji: '🕉️',
    dates: { 2026: '2026-09-14', 2027: '2027-09-04' },
  },
  {
    id: 'dussehra',
    label: 'Dussehra',
    emoji: '🏹',
    dates: { 2026: '2026-10-20' },
  },
  {
    id: 'diwali',
    label: 'Diwali',
    emoji: '🪔',
    dates: { 2026: '2026-11-08', 2027: '2027-10-29' },
  },
  { id: 'christmas', label: 'Christmas', emoji: '🎄', monthDay: '12-25' },
];

export function occasionById(id: string): Occasion | undefined {
  return OCCASIONS.find((o) => o.id === id);
}

function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function nextOccurrence(occasion: Occasion, from: Date): Date | null {
  const start = atMidnight(from);

  if (occasion.monthDay) {
    const [m, d] = occasion.monthDay.split('-').map(Number);
    const thisYear = new Date(start.getFullYear(), m - 1, d);
    return thisYear >= start
      ? thisYear
      : new Date(start.getFullYear() + 1, m - 1, d);
  }

  const upcoming = Object.values(occasion.dates ?? {})
    .map(parseIsoDate)
    .filter((date) => date >= start)
    .sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0] ?? null;
}

export function upcomingOccasions(
  from: Date,
  horizonDays = 150
): UpcomingOccasion[] {
  const start = atMidnight(from);
  const horizon = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + horizonDays
  );

  return OCCASIONS.map((occasion) => ({
    occasion,
    date: nextOccurrence(occasion, from),
  }))
    .filter(
      (entry): entry is UpcomingOccasion =>
        entry.date !== null && entry.date <= horizon
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function daysUntil(date: Date, from: Date): number {
  const ms = atMidnight(date).getTime() - atMidnight(from).getTime();
  return Math.round(ms / 86_400_000);
}
