import * as React from 'react';
import {
  DatePicker,
  DayOfWeek,
  Dropdown,
  MessageBar,
  MessageBarType,
  PrimaryButton,
  Stack,
  TextField,
  type IDropdownOption
} from '@fluentui/react';
import type { TeamEventsService } from '../services/TeamEventsService';
import { AttendeePicker, type IAttendeePersona } from './AttendeePicker';
import { combineDateAndTime, pad2, toTimeKey } from '../utils/dateUtils';
import styles from './TeamEvents.module.scss';

export interface IEventFormProps {
  service: TeamEventsService;
  hostName: string;
  onCreated: (start: Date) => void;
}

const TIME_OPTIONS: IDropdownOption[] = Array.from({ length: 96 }, (_, i) => {
  const key = `${pad2(Math.floor(i / 4))}:${pad2((i % 4) * 15)}`;
  return { key, text: key };
});

function nextFullHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

export const EventForm: React.FC<IEventFormProps> = ({ service, hostName, onCreated }) => {
  const initialStart = React.useMemo(nextFullHour, []);
  const initialEnd = React.useMemo(() => new Date(initialStart.getTime() + 60 * 60 * 1000), [initialStart]);

  const [title, setTitle] = React.useState('');
  const [startDay, setStartDay] = React.useState<Date>(initialStart);
  const [startTime, setStartTime] = React.useState(toTimeKey(initialStart));
  const [endDay, setEndDay] = React.useState<Date>(initialEnd);
  const [endTime, setEndTime] = React.useState(toTimeKey(initialEnd));
  const [attendees, setAttendees] = React.useState<IAttendeePersona[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: MessageBarType; text: string } | undefined>();

  const start = combineDateAndTime(startDay, startTime);
  const end = combineDateAndTime(endDay, endTime);
  const rangeError = end <= start ? 'End must be after start.' : undefined;
  const canSubmit = !!title.trim() && !rangeError && !submitting;

  const onStartDayChange = (date: Date | null | undefined): void => {
    if (!date) return;
    // Keep the end on the same relative day when moving the start.
    const shift = date.getTime() - new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate()).getTime();
    setStartDay(date);
    setEndDay(new Date(new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate()).getTime() + shift));
  };

  const onSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      await service.createEvent({ title: title.trim(), start, end, attendeeLogins: attendees.map(a => a.key) });
      setMessage({ type: MessageBarType.success, text: `"${title.trim()}" has been scheduled.` });
      setTitle('');
      setAttendees([]);
      onCreated(start);
    } catch (err) {
      setMessage({ type: MessageBarType.error, text: `Could not schedule the event: ${(err as Error).message}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>Schedule an event</h2>
      <Stack tokens={{ childrenGap: 12 }}>
        <TextField label="Title" required value={title} onChange={(_, v) => setTitle(v || '')} disabled={submitting} />
        <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
          <DatePicker
            label="Start"
            className={styles.datePicker}
            value={startDay}
            onSelectDate={onStartDayChange}
            firstDayOfWeek={DayOfWeek.Monday}
            disabled={submitting}
          />
          <Dropdown
            label="Time"
            className={styles.timePicker}
            options={TIME_OPTIONS}
            selectedKey={startTime}
            onChange={(_, o) => o && setStartTime(String(o.key))}
            disabled={submitting}
          />
        </Stack>
        <Stack horizontal tokens={{ childrenGap: 8 }} wrap>
          <DatePicker
            label="End"
            className={styles.datePicker}
            value={endDay}
            onSelectDate={d => d && setEndDay(d)}
            minDate={startDay}
            firstDayOfWeek={DayOfWeek.Monday}
            disabled={submitting}
          />
          <Dropdown
            label="Time"
            className={styles.timePicker}
            options={TIME_OPTIONS}
            selectedKey={endTime}
            onChange={(_, o) => o && setEndTime(String(o.key))}
            errorMessage={rangeError}
            disabled={submitting}
          />
        </Stack>
        <AttendeePicker service={service} selected={attendees} onChange={setAttendees} disabled={submitting} />
        <TextField label="Host" value={hostName} readOnly borderless description="You will be set as the host when you submit." />
        {message && (
          <MessageBar messageBarType={message.type} onDismiss={() => setMessage(undefined)}>
            {message.text}
          </MessageBar>
        )}
        <PrimaryButton text={submitting ? 'Scheduling...' : 'Schedule event'} onClick={onSubmit} disabled={!canSubmit} />
      </Stack>
    </div>
  );
};
