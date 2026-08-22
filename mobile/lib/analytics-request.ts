export const ANALYTICS_REQUEST_TIMEOUT_MS = 15_000;

export class AnalyticsTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out`);
    this.name = 'AnalyticsTimeoutError';
  }
}

export function retryAnalyticsRequest(
  failureCount: number,
  error: Error
): boolean {
  return !(error instanceof AnalyticsTimeoutError) && failureCount < 2;
}

export function withAnalyticsTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs: number = ANALYTICS_REQUEST_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AnalyticsTimeoutError(label));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
