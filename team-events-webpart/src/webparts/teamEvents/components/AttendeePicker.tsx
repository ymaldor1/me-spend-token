import * as React from 'react';
import { Label, NormalPeoplePicker, type IPersonaProps } from '@fluentui/react';
import type { TeamEventsService } from '../services/TeamEventsService';

export interface IAttendeePersona extends IPersonaProps {
  key: string;
}

export interface IAttendeePickerProps {
  service: TeamEventsService;
  selected: IAttendeePersona[];
  onChange: (selected: IAttendeePersona[]) => void;
  disabled?: boolean;
}

export const AttendeePicker: React.FC<IAttendeePickerProps> = ({ service, selected, onChange, disabled }) => {
  const onResolveSuggestions = async (filter: string, current?: IPersonaProps[]): Promise<IPersonaProps[]> => {
    if (!filter || filter.length < 2) {
      return [];
    }
    const results = await service.searchPeople(filter);
    const taken = new Set((current || []).map(p => (p as IAttendeePersona).key));
    return results
      .filter(r => !taken.has(r.key))
      .map<IAttendeePersona>(r => ({ key: r.key, text: r.displayText, secondaryText: r.email }));
  };

  return (
    <div>
      <Label>Attendees</Label>
      <NormalPeoplePicker
        selectedItems={selected}
        onResolveSuggestions={onResolveSuggestions}
        onChange={items => onChange((items || []) as IAttendeePersona[])}
        resolveDelay={300}
        disabled={disabled}
        pickerSuggestionsProps={{ suggestionsHeaderText: 'Suggested people', noResultsFoundText: 'No people found', loadingText: 'Searching...' }}
        inputProps={{ 'aria-label': 'Attendees', placeholder: selected.length ? '' : 'Type a name or email' }}
      />
    </div>
  );
};
