export const ANALYTICS_REQUEST_TIMEOUT_MS = 15_000;

export function withAnalyticsTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs: number = ANALYTICS_REQUEST_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out`));
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
