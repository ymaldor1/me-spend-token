import * as React from 'react';
import type { ITeamEventsProps } from './ITeamEventsProps';
import type { ITeamEvent } from '../services/TeamEventsService';
import { EventForm } from './EventForm';
import { WeekCalendar } from './WeekCalendar';
import { EventDetailsDialog } from './EventDetailsDialog';
import { addDays, startOfWeek } from '../utils/dateUtils';
import styles from './TeamEvents.module.scss';

const TeamEvents: React.FC<ITeamEventsProps> = ({ service, userDisplayName }) => {
  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(new Date()));
  const [events, setEvents] = React.useState<ITeamEvent[]>([]);
  const [currentUserId, setCurrentUserId] = React.useState<number | undefined>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [selected, setSelected] = React.useState<ITeamEvent | undefined>();
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    Promise.all([service.getCurrentUserId(), service.getMyEvents(weekStart, addDays(weekStart, 7))])
      .then(([userId, items]) => {
        if (cancelled) return;
        setCurrentUserId(userId);
        setEvents(items);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(`Could not load events: ${(err as Error).message}`);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [service, weekStart, reloadToken]);

  const reload = (): void => setReloadToken(t => t + 1);

  const onCreated = (start: Date): void => {
    const week = startOfWeek(start);
    if (week.getTime() === weekStart.getTime()) {
      reload();
    } else {
      setWeekStart(week);
    }
  };

  const onRemove = async (event: ITeamEvent): Promise<void> => {
    await service.removeFromMySchedule(event);
    setSelected(undefined);
    reload();
  };

  return (
    <section className={styles.teamEvents}>
      <div className={styles.layout}>
        <div className={styles.formColumn}>
          <EventForm service={service} hostName={userDisplayName} onCreated={onCreated} />
        </div>
        <div className={styles.calendarColumn}>
          <WeekCalendar
            weekStart={weekStart}
            events={events}
            currentUserId={currentUserId}
            loading={loading}
            error={error}
            onPrevWeek={() => setWeekStart(w => addDays(w, -7))}
            onNextWeek={() => setWeekStart(w => addDays(w, 7))}
            onToday={() => setWeekStart(startOfWeek(new Date()))}
            onSelectEvent={setSelected}
          />
        </div>
      </div>
      {selected && (
        <EventDetailsDialog
          event={selected}
          currentUserId={currentUserId}
          onDismiss={() => setSelected(undefined)}
          onRemove={onRemove}
        />
      )}
    </section>
  );
};

export default TeamEvents;
