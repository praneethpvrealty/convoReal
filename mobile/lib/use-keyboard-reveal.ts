import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  Keyboard,
  Platform,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

import { keyboardRevealDelta } from '@/lib/keyboard-reveal';

/**
 * Scrolls the focused field above the keyboard whenever the keyboard
 * opens or resizes over a form in a ScrollView. Attach the returned
 * handler as the ScrollView's onScroll (with scrollEventThrottle) so the
 * hook knows the current offset. KeyboardAvoidingView frees the space;
 * this moves the field into it, which neither platform does by itself
 * for a field that was tapped where the keyboard then appears. The field
 * is measured against the scroll view, so an input in a sheet above the
 * form fails that measurement and leaves the form where it is.
 */
export function useKeyboardReveal(scrollRef: RefObject<ScrollView | null>) {
  const scrollY = useRef(0);

  useEffect(() => {
    const subscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => {
        const input = TextInput.State.currentlyFocusedInput();
        const viewport = scrollRef.current?.getNativeScrollRef();
        if (!input || !viewport) return;
        const keyboardTop = event.endCoordinates.screenY;
        viewport.measureInWindow((_x, viewportTop) => {
          input.measureLayout(
            viewport,
            (_fieldX, fieldY, _width, height) => {
              const fieldTop = viewportTop + fieldY;
              const delta = keyboardRevealDelta({
                fieldTop,
                fieldBottom: fieldTop + height,
                viewportTop,
                keyboardTop,
              });
              if (delta > 0) {
                scrollRef.current?.scrollTo({
                  y: scrollY.current + delta,
                  animated: true,
                });
              }
            },
            () => undefined
          );
        });
      }
    );
    return () => subscription.remove();
  }, [scrollRef]);

  return useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);
}
