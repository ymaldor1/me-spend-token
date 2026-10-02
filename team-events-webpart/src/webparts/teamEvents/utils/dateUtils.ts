import type { ITeamEvent } from '../services/TeamEventsService';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 (local time) of the week containing the given date. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Combines the date part of `day` with "HH:mm". */
export function combineDateAndTime(day: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toTimeKey(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export interface IPositionedEvent {
  event: ITeamEvent;
  /** Minutes from midnight, clipped to the day. */
  startMinutes: number;
  endMinutes: number;
  column: number;
  columnCount: number;
}

/**
 * Lays out the events of a single day so overlapping events are shown side by side.
 * Events are grouped into clusters of transitively overlapping events; each cluster shares a column count.
 */
export function layoutDay(events: ITeamEvent[], day: Date): IPositionedEvent[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = dayStart + DAY_MS;

  const items = events
    .filter(e => e.start.getTime() < dayEnd && e.end.getTime() > dayStart)
    .map(e => ({
      event: e,
      startMinutes: Math.max(0, (e.start.getTime() - dayStart) / 60000),
      endMinutes: Math.min(24 * 60, (e.end.getTime() - dayStart) / 60000),
      column: 0,
      columnCount: 1
    }))
    .sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes);

  let cluster: IPositionedEvent[] = [];
  let columnsEnd: number[] = [];
  let clusterEnd = -1;

  const closeCluster = (): void => {
    cluster.forEach(c => { c.columnCount = columnsEnd.length; });
    cluster = [];
    columnsEnd = [];
  };

  for (const item of items) {
    if (item.startMinutes >= clusterEnd) {
      closeCluster();
    }
    let col = columnsEnd.findIndex(end => end <= item.startMinutes);
    if (col === -1) {
      col = columnsEnd.length;
      columnsEnd.push(item.endMinutes);
    } else {
      columnsEnd[col] = item.endMinutes;
    }
    item.column = col;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  closeCluster();

  return items;
}
