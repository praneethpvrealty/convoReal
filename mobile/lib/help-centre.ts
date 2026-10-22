import { openCopilotDesktopWeb } from './copilot-links';
import { ENV } from './env';

/** The public Help Centre on the web app — short illustrated guides. */
export function helpCentreUrl(): string {
  return `${ENV.apiBaseUrl}/help`;
}

export function openHelpCentre(): Promise<void> {
  return openCopilotDesktopWeb(helpCentreUrl());
}
