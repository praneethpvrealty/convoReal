import type { BeforeSendMiddleware } from '@vercel/speed-insights';

export const sanitizePerformanceEvent: BeforeSendMiddleware = (event) => {
  if (!event.route?.startsWith('/') || event.route.startsWith('//'))
    return null;

  try {
    const url = new URL(event.url);
    url.pathname = event.route;
    url.search = '';
    url.hash = '';
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
};
