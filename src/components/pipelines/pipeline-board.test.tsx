// @vitest-environment happy-dom

import { Fragment, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { Deal, PipelineStage } from '@/types';
import type { BoardLayout } from '@/lib/pipelines/board-layout';
import { PipelineBoard } from './pipeline-board';

vi.mock('./stage-wheel', () => ({
  StageWheel: ({
    stages,
    renderStage,
  }: {
    stages: PipelineStage[];
    renderStage: (stage: PipelineStage) => ReactNode;
  }) => (
    <div>
      {stages.map((stage) => (
        <Fragment key={stage.id}>{renderStage(stage)}</Fragment>
      ))}
    </div>
  ),
}));

function stage(
  id: string,
  name: string,
  position: number,
  stage_type: string
): PipelineStage {
  return {
    id,
    pipeline_id: 'pipeline-1',
    name,
    position,
    color: '#6366f1',
    stage_type,
    created_at: '2026-01-01',
  };
}

function deal(id: string, stageId: string, title: string): Deal {
  return {
    id,
    user_id: 'user-1',
    pipeline_id: 'pipeline-1',
    stage_id: stageId,
    contact_id: null,
    title,
    value: 10_000_000,
    status: 'open',
    created_at: '2026-01-01',
  };
}

const stages = [
  stage('s-lost', 'Closed Lost', 3, 'lost'),
  stage('s-won', 'Registered', 2, 'won'),
  stage('s-enquiry', 'Enquiry', 0, 'open'),
  stage('s-visit', 'Site visit', 1, 'open'),
];

const deals = [
  deal('d-1', 's-enquiry', 'Koramangala plot'),
  deal('d-2', 's-won', 'Indiranagar flat'),
  deal('d-3', 's-lost', 'Whitefield villa'),
];

function renderBoard(layout: BoardLayout, onAddDeal = vi.fn()) {
  render(
    <PipelineBoard
      stages={stages}
      deals={deals}
      onDealMoved={vi.fn()}
      onAddDeal={onAddDeal}
      onEditDeal={vi.fn()}
      layout={layout}
    />
  );
  return { onAddDeal };
}

afterEach(() => {
  cleanup();
});

describe('[PIPE-001] the flat Deals board', () => {
  it('lays every stage out in one row in position order, terminal stages last', () => {
    renderBoard('flat');
    const row = screen.getByLabelText('Pipeline stages');
    const labels = within(row)
      .getAllByText(
        /^(Enquiry|Site visit|Closed won|Registered|Lost|Closed Lost)$/
      )
      .map((node) => node.textContent);
    expect(labels).toEqual([
      'Enquiry',
      'Site visit',
      'Closed won',
      'Registered',
      'Lost',
      'Closed Lost',
    ]);
    expect(screen.queryByText('Active pipeline')).toBeNull();
    expect(screen.queryByText('Successful')).toBeNull();
    expect(screen.queryByText('Lost deals')).toBeNull();
  });

  it('keeps won and lost stages at the right edge even when they were reordered before an active stage', () => {
    render(
      <PipelineBoard
        stages={[
          stage('s-lost', 'Closed Lost', 0, 'lost'),
          stage('s-won', 'Registered', 1, 'won'),
          stage('s-enquiry', 'Enquiry', 2, 'open'),
          stage('s-visit', 'Site visit', 3, 'open'),
        ]}
        deals={deals}
        onDealMoved={vi.fn()}
        onAddDeal={vi.fn()}
        onEditDeal={vi.fn()}
        layout="flat"
      />
    );
    const row = screen.getByLabelText('Pipeline stages');
    const labels = within(row)
      .getAllByText(
        /^(Enquiry|Site visit|Closed won|Registered|Lost|Closed Lost)$/
      )
      .map((node) => node.textContent);
    expect(labels).toEqual([
      'Enquiry',
      'Site visit',
      'Closed won',
      'Registered',
      'Lost',
      'Closed Lost',
    ]);
  });

  it('collapses an empty stage to a rail that still adds deals and expands on click', () => {
    const { onAddDeal } = renderBoard('flat');
    expect(screen.queryByRole('heading', { name: 'Site visit' })).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Add deal to Site visit' })
    );
    expect(onAddDeal).toHaveBeenCalledWith('s-visit');

    fireEvent.click(
      screen.getByRole('button', { name: 'Show Site visit, no deals' })
    );
    expect(screen.getByRole('heading', { name: 'Site visit' })).toBeTruthy();
    expect(screen.getByText('Drop a deal here')).toBeTruthy();
  });
});

describe('[PIPE-001] the wheel Deals board', () => {
  it('keeps the Active pipeline, Successful and Lost deals sections', () => {
    renderBoard('wheel');
    expect(
      screen.getByRole('heading', { name: 'Active pipeline' })
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Successful' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Lost deals' })).toBeTruthy();
    expect(screen.queryByLabelText('Pipeline stages')).toBeNull();
  });
});
