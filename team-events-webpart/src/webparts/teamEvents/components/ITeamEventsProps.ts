import type { TeamEventsService } from '../services/TeamEventsService';

export interface ITeamEventsProps {
  service: TeamEventsService;
  userDisplayName: string;
}
