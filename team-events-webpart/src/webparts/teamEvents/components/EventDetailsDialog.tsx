import * as React from 'react';
import {
  DefaultButton,
  Dialog,
  DialogFooter,
  DialogType,
  MessageBar,
  MessageBarType,
  Persona,
  PersonaSize,
  PrimaryButton,
  Stack
} from '@fluentui/react';
import type { ITeamEvent } from '../services/TeamEventsService';
import { formatDateTime } from '../utils/dateUtils';
import styles from './TeamEvents.module.scss';

export interface IEventDetailsDialogProps {
  event: ITeamEvent;
  currentUserId?: number;
  onDismiss: () => void;
  onRemove: (event: ITeamEvent) => Promise<void>;
}

export const EventDetailsDialog: React.FC<IEventDetailsDialogProps> = ({ event, currentUserId, onDismiss, onRemove }) => {
  const [confirming, setConfirming] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const isHost = event.host?.id === currentUserId;

  const remove = async (): Promise<void> => {
    setRemoving(true);
    setError(undefined);
    try {
      await onRemove(event);
    } catch (err) {
      setError((err as Error).message);
      setRemoving(false);
    }
  };

  return (
    <Dialog
      hidden={false}
      onDismiss={removing ? undefined : onDismiss}
      minWidth={420}
      dialogContentProps={{
        type: DialogType.close,
        title: event.title,
        subText: `${formatDateTime(event.start)} - ${formatDateTime(event.end)}`
      }}
    >
      <Stack tokens={{ childrenGap: 12 }}>
        <span className={`${styles.roleBadge} ${isHost ? styles.hosted : styles.attending}`}>
          {isHost ? 'You are hosting' : 'You are attending'}
        </span>
        <div>
          <div className={styles.sectionLabel}>Host</div>
          {event.host ? (
            <Persona text={event.host.title} secondaryText={event.host.email} size={PersonaSize.size32} />
          ) : (
            <span>Not set</span>
          )}
        </div>
        <div>
          <div className={styles.sectionLabel}>Attendees ({event.attendees.length})</div>
          <Stack tokens={{ childrenGap: 6 }}>
            {event.attendees.length === 0 && <span>No attendees</span>}
            {event.attendees.map(a => (
              <Persona key={a.id} text={a.title} secondaryText={a.email} size={PersonaSize.size24} />
            ))}
          </Stack>
        </div>
        {confirming && (
          <MessageBar messageBarType={isHost ? MessageBarType.severeWarning : MessageBarType.warning}>
            {isHost
              ? 'You are the host: the event will be deleted for everyone.'
              : 'You will be removed from the attendees of this event.'}
          </MessageBar>
        )}
        {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}
      </Stack>
      <DialogFooter>
        {confirming ? (
          <>
            <PrimaryButton
              text={removing ? 'Removing...' : isHost ? 'Delete event' : 'Remove me'}
              onClick={remove}
              disabled={removing}
            />
            <DefaultButton text="Cancel" onClick={() => setConfirming(false)} disabled={removing} />
          </>
        ) : (
          <>
            <PrimaryButton text="Remove from my schedule" onClick={() => setConfirming(true)} />
            <DefaultButton text="Close" onClick={onDismiss} />
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
};
