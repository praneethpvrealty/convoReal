// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Deal, PipelineStage } from '@/types';
import {
  KPI_EXPANDED_STORAGE_KEY,
  PipelineAnalytics,
} from './pipeline-analytics';

const stages: PipelineStage[] = [
  {
    id: 's-enquiry',
    pipeline_id: 'pipeline-1',
    name: 'Enquiry',
    position: 0,
    color: '#6366f1',
    stage_type: 'open',
    created_at: '2026-01-01',
  },
  {
    id: 's-won',
    pipeline_id: 'pipeline-1',
    name: 'Registered',
    position: 1,
    color: '#6366f1',
    stage_type: 'won',
    created_at: '2026-01-01',
  },
];

const deals: Deal[] = [
  {
    id: 'd-1',
    user_id: 'user-1',
    pipeline_id: 'pipeline-1',
    stage_id: 's-enquiry',
    contact_id: null,
    title: 'Koramangala plot',
    value: 10_000_000,
    status: 'open',
    created_at: '2026-01-01',
  },
];

function renderStrip() {
  return render(
    <PipelineAnalytics stages={stages} deals={deals} scopeLabel="All" />
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Deals KPI strip', () => {
  it('shows the three primary tiles and folds the rest behind More', () => {
    renderStrip();
    expect(screen.getByText('Pipeline value')).toBeTruthy();
    expect(screen.getByText('Weighted revenue')).toBeTruthy();
    expect(screen.getByText('Won this month')).toBeTruthy();
    expect(screen.queryByText('Deals shown')).toBeNull();
    expect(screen.queryByText('Avg brokerage')).toBeNull();
    expect(screen.queryByText('Lost this month')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'More' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('reveals the secondary tiles and remembers the choice', () => {
    renderStrip();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('Deals shown')).toBeTruthy();
    expect(screen.getByText('Avg brokerage')).toBeTruthy();
    expect(screen.getByText('Lost this month')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Less' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem(KPI_EXPANDED_STORAGE_KEY)).toBe('1');

    cleanup();
    renderStrip();
    expect(screen.getByText('Lost this month')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Less' }));
    expect(screen.queryByText('Lost this month')).toBeNull();
    expect(window.localStorage.getItem(KPI_EXPANDED_STORAGE_KEY)).toBe('0');
  });

  it('keeps a calculation tooltip on every tile', () => {
    renderStrip();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    for (const label of [
      'Pipeline value',
      'Weighted revenue',
      'Won this month',
      'Deals shown',
      'Avg brokerage',
      'Lost this month',
    ]) {
      expect(
        screen.getByRole('button', { name: `How ${label} is calculated` })
      ).toBeTruthy();
    }
  });
});
