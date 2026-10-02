import { SPHttpClient, type SPHttpClientResponse } from '@microsoft/sp-http';

export interface IPerson {
  id: number;
  title: string;
  email?: string;
}

export interface ITeamEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  host?: IPerson;
  attendees: IPerson[];
}

export interface INewTeamEvent {
  title: string;
  start: Date;
  end: Date;
  /** Claims login names returned by the people picker. */
  attendeeLogins: string[];
}

export interface IPeopleSuggestion {
  key: string;
  displayText: string;
  email?: string;
}

interface ISpUser {
  Id: number;
  Title: string;
  EMail?: string;
}

interface ISpEventItem {
  Id: number;
  Title: string;
  EventDate: string;
  // SharePoint returns null for empty values; the optional checks below cover both.
  EndDate?: string;
  Host?: ISpUser;
  Attendees?: ISpUser[];
}

const DEFAULT_DURATION_MS = 60 * 60 * 1000;

const JSON_HEADERS = {
  Accept: 'application/json;odata=nometadata',
  'Content-Type': 'application/json;odata=nometadata',
  'odata-version': ''
};

export class TeamEventsService {
  private _currentUserId: number | undefined;

  constructor(
    private readonly _spHttpClient: SPHttpClient,
    private readonly _webUrl: string,
    private readonly _listTitle: string
  ) {}

  private get _itemsUrl(): string {
    return `${this._webUrl}/_api/web/lists/getbytitle('${encodeURIComponent(this._listTitle.replace(/'/g, "''"))}')/items`;
  }

  public async getCurrentUserId(): Promise<number> {
    if (this._currentUserId === undefined) {
      const user = await this._get<ISpUser>(`${this._webUrl}/_api/web/currentuser?$select=Id`);
      this._currentUserId = user.Id;
    }
    return this._currentUserId;
  }

  /** Events hosted or attended by the current user that intersect [rangeStart, rangeEnd). */
  public async getMyEvents(rangeStart: Date, rangeEnd: Date): Promise<ITeamEvent[]> {
    const userId = await this.getCurrentUserId();
    // Look back one extra day so multi-hour events that started before the range are still caught.
    const lookBack = new Date(rangeStart.getTime() - 24 * 60 * 60 * 1000);
    const filter =
      `(Host/Id eq ${userId} or Attendees/Id eq ${userId})` +
      ` and EventDate ge datetime'${lookBack.toISOString()}'` +
      ` and EventDate lt datetime'${rangeEnd.toISOString()}'`;
    const url =
      `${this._itemsUrl}?$select=Id,Title,EventDate,EndDate,Host/Id,Host/Title,Host/EMail,Attendees/Id,Attendees/Title,Attendees/EMail` +
      `&$expand=Host,Attendees&$filter=${encodeURIComponent(filter)}&$orderby=EventDate&$top=500`;

    const result = await this._get<{ value: ISpEventItem[] }>(url);
    return result.value
      .map(item => this._toEvent(item))
      .filter(e => e.end > rangeStart && e.start < rangeEnd);
  }

  public async createEvent(event: INewTeamEvent): Promise<void> {
    const hostId = await this.getCurrentUserId();
    const attendeeIds = await Promise.all(event.attendeeLogins.map(login => this._ensureUser(login)));
    const uniqueAttendees = attendeeIds.filter((id, i, all) => id !== hostId && all.indexOf(id) === i);

    await this._post(this._itemsUrl, {
      Title: event.title,
      EventDate: event.start.toISOString(),
      EndDate: event.end.toISOString(),
      HostId: hostId,
      AttendeesId: uniqueAttendees
    });
  }

  /**
   * Host: deletes the item for everyone.
   * Attendee: removes only the current user from the Attendees column.
   */
  public async removeFromMySchedule(event: ITeamEvent): Promise<void> {
    const userId = await this.getCurrentUserId();
    const itemUrl = `${this._itemsUrl}(${event.id})`;

    if (event.host?.id === userId) {
      await this._post(itemUrl, undefined, { 'IF-MATCH': '*', 'X-HTTP-Method': 'DELETE' });
      return;
    }

    // Re-read attendees to avoid overwriting changes made since the calendar was loaded.
    const current = await this._get<ISpEventItem>(`${itemUrl}?$select=Attendees/Id&$expand=Attendees`);
    const remaining = (current.Attendees || []).map(a => a.Id).filter(id => id !== userId);
    await this._post(itemUrl, { AttendeesId: remaining }, { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' });
  }

  public async searchPeople(query: string): Promise<IPeopleSuggestion[]> {
    const response = await this._post(
      `${this._webUrl}/_api/SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser`,
      {
        queryParams: {
          QueryString: query,
          MaximumEntitySuggestions: 10,
          AllowEmailAddresses: false,
          AllowMultipleEntities: false,
          PrincipalSource: 15,
          PrincipalType: 1 // users only
        }
      }
    );
    const payload: { value: string } = await response.json();
    const entities: Array<{ Key: string; DisplayText: string; EntityData?: { Email?: string } }> = JSON.parse(payload.value);
    return entities.map(e => ({ key: e.Key, displayText: e.DisplayText, email: e.EntityData?.Email }));
  }

  private async _ensureUser(logonName: string): Promise<number> {
    const response = await this._post(`${this._webUrl}/_api/web/ensureuser`, { logonName });
    const user: ISpUser = await response.json();
    return user.Id;
  }

  private _toEvent(item: ISpEventItem): ITeamEvent {
    const start = new Date(item.EventDate);
    const end = item.EndDate ? new Date(item.EndDate) : new Date(start.getTime() + DEFAULT_DURATION_MS);
    const toPerson = (u: ISpUser): IPerson => ({ id: u.Id, title: u.Title, email: u.EMail });
    return {
      id: item.Id,
      title: item.Title,
      start,
      end: end > start ? end : new Date(start.getTime() + DEFAULT_DURATION_MS),
      host: item.Host ? toPerson(item.Host) : undefined,
      attendees: (item.Attendees || []).map(toPerson)
    };
  }

  private async _get<T>(url: string): Promise<T> {
    const response = await this._spHttpClient.get(url, SPHttpClient.configurations.v1, { headers: JSON_HEADERS });
    await this._ensureOk(response);
    return response.json();
  }

  private async _post(url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<SPHttpClientResponse> {
    const response = await this._spHttpClient.post(url, SPHttpClient.configurations.v1, {
      headers: { ...JSON_HEADERS, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    await this._ensureOk(response);
    return response;
  }

  private async _ensureOk(response: SPHttpClientResponse): Promise<void> {
    if (response.ok) {
      return;
    }
    let message = `${response.status} ${response.statusText}`;
    try {
      const error = await response.json();
      message = error?.['odata.error']?.message?.value || error?.error?.message || message;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
}
