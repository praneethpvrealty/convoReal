'use client';

import { useCallback, useReducer } from 'react';
import {
  emptyPropertyFormValues,
  propertyFormReducer,
  type PropertyFormAction,
  type PropertyFormField,
  type PropertyFormUpdate,
  type PropertyFormValues,
} from '@/lib/inventory/property-form-state';

export type SetPropertyFormField = <K extends PropertyFormField>(
  field: K,
  value: PropertyFormUpdate<K>
) => void;

export function usePropertyForm(defaultOwnerId: string | null) {
  const [values, dispatch] = useReducer(
    propertyFormReducer,
    defaultOwnerId,
    emptyPropertyFormValues
  );

  const set = useCallback<SetPropertyFormField>((field, value) => {
    dispatch({ type: 'set', field, value } as PropertyFormAction);
  }, []);

  const reset = useCallback((next: PropertyFormValues) => {
    dispatch({ type: 'reset', values: next });
  }, []);

  return { values, set, reset };
}
