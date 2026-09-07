import * as WebBrowser from 'expo-web-browser';

const CONVOREAL_WEB_URL = 'https://www.convoreal.com';

export async function openCopilotDesktopWeb(url?: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url ?? CONVOREAL_WEB_URL);
}
