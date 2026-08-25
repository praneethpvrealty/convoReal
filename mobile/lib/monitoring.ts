import * as Sentry from '@sentry/react-native';
import { sanitizeSentryEvent } from './sentry-sanitize';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const environment =
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ??
  (__DEV__ ? 'development' : 'production');

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && !__DEV__,
  environment,
  sendDefaultPii: false,
  tracesSampleRate: environment === 'production' ? 0.1 : 0,
  beforeSend: sanitizeSentryEvent,
});

export { Sentry };
