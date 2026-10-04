// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  usePropertyForm,
  type SetPropertyFormField,
} from '@/hooks/usePropertyForm';
import { emptyPropertyFormValues } from '@/lib/inventory/property-form-state';
import { BasicsSection } from './basics-section';

afterEach(cleanup);

function field<T extends HTMLElement>(container: HTMLElement, id: string): T {
  const element = container.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`#${id} is not rendered`);
  return element;
}

describe('BasicsSection', () => {
  it('renders an empty Sale listing with its price field', () => {
    const { container } = render(
      <BasicsSection
        values={emptyPropertyFormValues(null)}
        set={vi.fn()}
        isEdit={false}
        property={null}
      />
    );

    expect(container.querySelector('#pf-basics')).not.toBeNull();
    expect(field<HTMLSelectElement>(container, 'prop-listing-type').value).toBe(
      'Sale'
    );
    expect(container.querySelector('#prop-price')).not.toBeNull();
    expect(container.querySelector('#prop-rent')).toBeNull();
    expect(container.querySelector('#prop-status')).toBeNull();
  });

  it('reports a typed price through set', () => {
    const set = vi.fn();
    const { container } = render(
      <BasicsSection
        values={emptyPropertyFormValues(null)}
        set={set}
        isEdit={false}
        property={null}
      />
    );

    fireEvent.change(field(container, 'prop-price'), {
      target: { value: '12000000' },
    });

    expect(set).toHaveBeenCalledWith('price', '12000000');
  });

  it('shows the rent fields once the listing type switches to Rent', () => {
    const calls: Array<[string, unknown]> = [];
    function Harness() {
      const { values, set } = usePropertyForm(null);
      const tracked: SetPropertyFormField = (name, value) => {
        calls.push([name, value]);
        set(name, value);
      };
      return (
        <BasicsSection
          values={values}
          set={tracked}
          isEdit={false}
          property={null}
        />
      );
    }
    const { container } = render(<Harness />);

    fireEvent.change(field(container, 'prop-listing-type'), {
      target: { value: 'Rent' },
    });

    expect(calls).toContainEqual(['listingType', 'Rent']);
    expect(screen.getByText(/Rent per month \(INR\)/)).toBeTruthy();
    expect(container.querySelector('#prop-rent')).not.toBeNull();
    expect(container.querySelector('#prop-maintenance')).not.toBeNull();
    expect(container.querySelector('#prop-advance')).not.toBeNull();
    expect(container.querySelector('#prop-gst')).not.toBeNull();
    expect(container.querySelector('#prop-price')).toBeNull();
  });
});
