// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShowcasePresentationControls } from '@/components/settings/showcase-presentation-controls';

afterEach(cleanup);

describe('ShowcasePresentationControls', () => {
  it('offers every showcase style and updates the selected style', () => {
    const onValueChange = vi.fn();
    render(
      <ShowcasePresentationControls
        title="Company listing style"
        description="Choose a design."
        value="gallery"
        threeDimensional
        onValueChange={onValueChange}
        onThreeDimensionalChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: /Gallery/ }).getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Spotlight/ }));
    expect(onValueChange).toHaveBeenCalledWith('spotlight');
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('turns responsive 3D transitions off', () => {
    const onThreeDimensionalChange = vi.fn();
    render(
      <ShowcasePresentationControls
        title="Personal showcase style"
        description="Choose a design."
        value="signature"
        threeDimensional
        onValueChange={vi.fn()}
        onThreeDimensionalChange={onThreeDimensionalChange}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /3D property transitions/ })
    );
    expect(onThreeDimensionalChange).toHaveBeenCalledWith(false);
  });
});
