import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dismissAppDialog,
  showAppDialog,
  useAppDialogStore,
} from '@/lib/app-dialog-store';

describe('app dialog queue', () => {
  beforeEach(() => {
    useAppDialogStore.setState({ queue: [] });
  });

  it('shows dialogs one at a time in the order they were raised', () => {
    showAppDialog({ title: 'Not recorded' });
    showAppDialog({ title: 'Event updated' });
    expect(useAppDialogStore.getState().queue.map((d) => d.title)).toEqual([
      'Not recorded',
      'Event updated',
    ]);
    dismissAppDialog();
    expect(useAppDialogStore.getState().queue.map((d) => d.title)).toEqual([
      'Event updated',
    ]);
    dismissAppDialog();
    dismissAppDialog();
    expect(useAppDialogStore.getState().queue).toEqual([]);
  });

  it('keeps the actions and dismiss handler the caller supplied', () => {
    const onPress = vi.fn();
    const onDismiss = vi.fn();
    showAppDialog({
      title: 'Open → Completed',
      actions: [{ label: 'Complete now', onPress }],
      onDismiss,
    });
    const [dialog] = useAppDialogStore.getState().queue;
    dialog.actions?.[0].onPress();
    dialog.onDismiss?.();
    expect(onPress).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
