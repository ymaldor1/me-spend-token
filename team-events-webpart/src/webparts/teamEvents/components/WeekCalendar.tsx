import * as React from 'react';
import { DefaultButton, IconButton, Spinner, SpinnerSize, MessageBar, MessageBarType } from '@fluentui/react';
import type { ITeamEvent } from '../services/TeamEventsService';
import { addDays, formatTime, isSameDay, layoutDay, pad2 } from '../utils/dateUtils';
import styles from './TeamEvents.module.scss';

export interface IWeekCalendarProps {
  weekStart: Date;
  events: ITeamEvent[];
  currentUserId?: number;
  loading: boolean;
  error?: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onSelectEvent: (event: ITeamEvent) => void;
}

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const WeekCalendar: React.FC<IWeekCalendarProps> = props => {
  const { weekStart, events, currentUserId, loading, error } = props;
  const days = React.useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const today = new Date();

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT;
    }
  }, []);

  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = `${weekStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div className={styles.card}>
      <div className={styles.calendarToolbar}>
        <h2 className={styles.cardTitle}>My week</h2>
        <div className={styles.calendarNav}>
          <DefaultButton text="Today" onClick={props.onToday} />
          <IconButton iconProps={{ iconName: 'ChevronLeft' }} title="Previous week" ariaLabel="Previous week" onClick={props.onPrevWeek} />
          <IconButton iconProps={{ iconName: 'ChevronRight' }} title="Next week" ariaLabel="Next week" onClick={props.onNextWeek} />
          <span className={styles.rangeLabel}>{rangeLabel}</span>
          {loading && <Spinner size={SpinnerSize.small} />}
        </div>
        <div className={styles.legend}>
          <span className={`${styles.legendSwatch} ${styles.hosted}`} /> Hosting
          <span className={`${styles.legendSwatch} ${styles.attending}`} /> Attending
        </div>
      </div>

      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}

      <div className={styles.calendar}>
        <div className={styles.calendarHeader}>
          <div className={styles.timeGutter} />
          {days.map(day => (
            <div key={day.toISOString()} className={`${styles.dayHeader} ${isSameDay(day, today) ? styles.today : ''}`}>
              <span className={styles.dayName}>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className={styles.dayNumber}>{day.getDate()}</span>
            </div>
          ))}
        </div>

        <div className={styles.calendarBody} ref={scrollRef}>
          <div className={styles.timeGutter}>
            {HOURS.map(h => (
              <div key={h} className={styles.hourLabel} style={{ height: HOUR_HEIGHT }}>
                {h === 0 ? '' : `${pad2(h)}:00`}
              </div>
            ))}
          </div>

          {days.map(day => (
            <div key={day.toISOString()} className={`${styles.dayColumn} ${isSameDay(day, today) ? styles.todayColumn : ''}`} style={{ height: 24 * HOUR_HEIGHT }}>
              {HOURS.map(h => (
                <div key={h} className={styles.hourSlot} style={{ height: HOUR_HEIGHT }} />
              ))}
              {layoutDay(events, day).map(p => {
                const isHost = p.event.host?.id === currentUserId;
                const width = 100 / p.columnCount;
                return (
                  <button
                    type="button"
                    key={p.event.id}
                    className={`${styles.event} ${isHost ? styles.hosted : styles.attending}`}
                    style={{
                      top: (p.startMinutes / 60) * HOUR_HEIGHT,
                      height: Math.max(((p.endMinutes - p.startMinutes) / 60) * HOUR_HEIGHT - 2, 18),
                      left: `calc(${p.column * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`
                    }}
                    title={`${p.event.title} (${formatTime(p.event.start)} - ${formatTime(p.event.end)})`}
                    onClick={() => props.onSelectEvent(p.event)}
                  >
                    <span className={styles.eventTitle}>{p.event.title}</span>
                    <span className={styles.eventTime}>
                      {formatTime(p.event.start)} - {formatTime(p.event.end)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
