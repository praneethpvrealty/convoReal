export interface ShutdownGate {
  beginWork(): void;
  finishWork(): void;
  requestShutdown(): void;
  shouldContinue(): boolean;
}

export function createShutdownGate(onIdle: () => void): ShutdownGate {
  let activeWork = 0;
  let stopping = false;
  let idleNotified = false;

  const notifyWhenIdle = () => {
    if (!stopping || activeWork > 0 || idleNotified) return;
    idleNotified = true;
    onIdle();
  };

  return {
    beginWork() {
      activeWork += 1;
    },
    finishWork() {
      activeWork = Math.max(0, activeWork - 1);
      notifyWhenIdle();
    },
    requestShutdown() {
      stopping = true;
      notifyWhenIdle();
    },
    shouldContinue() {
      return !stopping;
    },
  };
}
