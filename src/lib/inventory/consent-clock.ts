import {
  quietPeriodStatus,
  type QuietPeriod,
} from '@/lib/notifications/quiet-hours';

export const CONSENT_AWAKE_MS = 4 * 60 * 60 * 1000;
export const CONSENT_REMINDER_AWAKE_MS = 2 * 60 * 60 * 1000;
export const LEGACY_CONSENT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const STEP_MS = 60 * 1000;
const MAX_STEPS = 14 * 24 * 60;

export function addAwakeTime(
  start: Date,
  awakeMs: number,
  period: QuietPeriod
): Date {
  let t = start.getTime();
  let left = awakeMs;
  for (let i = 0; left > 0 && i < MAX_STEPS; i++) {
    const status = quietPeriodStatus(new Date(t), period);
    if (status.isQuiet && status.deliverAt && status.deliverAt.getTime() > t) {
      t = status.deliverAt.getTime();
      continue;
    }
    const step = Math.min(left, STEP_MS);
    t += step;
    left -= step;
  }
  return new Date(t);
}

export function consentSchedule(
  askedAt: Date,
  period: QuietPeriod
): { remindAt: Date; deadlineAt: Date } {
  return {
    remindAt: addAwakeTime(askedAt, CONSENT_REMINDER_AWAKE_MS, period),
    deadlineAt: addAwakeTime(askedAt, CONSENT_AWAKE_MS, period),
  };
}
