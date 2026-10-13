import { create } from 'zustand';

export interface DialogAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'default' | 'muted' | 'destructive';
}

export interface DialogSpec {
  title: string;
  message?: string;
  /** Omit for a single primary "OK" that dismisses. */
  actions?: DialogAction[];
  /** Runs when the dialog is closed by a backdrop tap or the Android
   *  back gesture rather than by one of its actions. */
  onDismiss?: () => void;
}

interface AppDialogState {
  queue: DialogSpec[];
}

/**
 * Dialogs raised from code with no component tree to render one into: a
 * lib helper, a notice that arrives after the sheet that started the work
 * has closed, a confirmation inside a plain async function. `AppDialogHost`
 * at the root shows them one at a time, in order. Screens and sheets keep
 * `useAppDialog()` so a dialog raised inside an open sheet stays in that
 * sheet's tree, where it cannot end up behind it.
 */
export const useAppDialogStore = create<AppDialogState>(() => ({ queue: [] }));

export function showAppDialog(spec: DialogSpec): void {
  useAppDialogStore.setState((state) => ({ queue: [...state.queue, spec] }));
}

export function dismissAppDialog(): void {
  useAppDialogStore.setState((state) => ({ queue: state.queue.slice(1) }));
}
