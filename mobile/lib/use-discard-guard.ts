import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useRef } from 'react';

import type { DialogSpec } from '@/components/app-dialog';

export function useDiscardGuard(
  dirty: boolean,
  dialog: { show: (spec: DialogSpec) => void; close: () => void }
) {
  const navigation = useNavigation();
  const allowLeave = useRef(false);

  usePreventRemove(dirty, ({ data }) => {
    if (allowLeave.current) {
      navigation.dispatch(data.action);
      return;
    }
    dialog.show({
      title: 'Discard changes?',
      message: 'Your edits on this screen have not been saved.',
      actions: [
        { label: 'Keep editing', variant: 'muted', onPress: dialog.close },
        {
          label: 'Discard',
          variant: 'destructive',
          onPress: () => {
            dialog.close();
            allowLeave.current = true;
            navigation.dispatch(data.action);
          },
        },
      ],
    });
  });

  return useCallback(() => {
    allowLeave.current = true;
  }, []);
}
