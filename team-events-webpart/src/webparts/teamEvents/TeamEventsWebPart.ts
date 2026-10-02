import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import {
  type IPropertyPaneConfiguration,
  PropertyPaneTextField
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import type { IReadonlyTheme } from '@microsoft/sp-component-base';

import * as strings from 'TeamEventsWebPartStrings';
import TeamEvents from './components/TeamEvents';
import type { ITeamEventsProps } from './components/ITeamEventsProps';
import { TeamEventsService } from './services/TeamEventsService';

export interface ITeamEventsWebPartProps {
  listTitle: string;
}

export default class TeamEventsWebPart extends BaseClientSideWebPart<ITeamEventsWebPartProps> {
  private _service: TeamEventsService | undefined;

  public render(): void {
    const listTitle = this.properties.listTitle || 'TeamEvents';
    this._service = this._service || new TeamEventsService(this.context.spHttpClient, this.context.pageContext.web.absoluteUrl, listTitle);

    const element: React.ReactElement<ITeamEventsProps> = React.createElement(TeamEvents, {
      service: this._service,
      userDisplayName: this.context.pageContext.user.displayName
    });

    ReactDom.render(element, this.domElement);
  }

  protected onPropertyPaneFieldChanged(propertyPath: string, oldValue: unknown, newValue: unknown): void {
    if (propertyPath === 'listTitle' && oldValue !== newValue) {
      this._service = undefined;
    }
    super.onPropertyPaneFieldChanged(propertyPath, oldValue, newValue);
  }

  protected onThemeChanged(currentTheme: IReadonlyTheme | undefined): void {
    const semanticColors = currentTheme?.semanticColors;
    if (semanticColors) {
      this.domElement.style.setProperty('--bodyText', semanticColors.bodyText || null);
    }
  }

  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected get disableReactivePropertyChanges(): boolean {
    return true;
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: { description: strings.PropertyPaneDescription },
          groups: [
            {
              groupName: strings.BasicGroupName,
              groupFields: [
                PropertyPaneTextField('listTitle', { label: strings.ListTitleFieldLabel })
              ]
            }
          ]
        }
      ]
    };
  }
}
