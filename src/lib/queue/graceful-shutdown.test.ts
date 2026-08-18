import { describe, expect, it, vi } from 'vitest';
import { createShutdownGate } from './graceful-shutdown';

describe('createShutdownGate', () => {
  it('waits for an active webhook before closing the queue connection', () => {
    const onIdle = vi.fn();
    const gate = createShutdownGate(onIdle);

    gate.beginWork();
    gate.requestShutdown();

    expect(gate.shouldContinue()).toBe(false);
    expect(onIdle).not.toHaveBeenCalled();

    gate.finishWork();

    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('closes immediately when shutdown arrives while idle', () => {
    const onIdle = vi.fn();
    const gate = createShutdownGate(onIdle);

    gate.requestShutdown();
    gate.requestShutdown();

    expect(onIdle).toHaveBeenCalledOnce();
  });
});
