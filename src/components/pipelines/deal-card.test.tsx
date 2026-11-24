// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Deal, PipelineStage } from '@/types';
import { DealCard } from './deal-card';

const stage = {
  id: 's1',
  name: 'Enquiry → Shortlist',
  stage_type: 'open',
  color: '#3b82f6',
  position: 0,
} as unknown as PipelineStage;

const deal = {
  id: 'd1',
  title: 'Plot',
  stage_id: 's1',
  status: 'open',
  value: 9000000,
  contact: { id: 'c1', name: 'Anil Reddy', phone: '919800000000' },
} as unknown as Deal;

afterEach(cleanup);

describe('DealCard', () => {
  it('[PIPE-006] opens the stage message without opening the deal', () => {
    const onEdit = vi.fn();
    const onMessage = vi.fn();
    render(
      <DealCard
        deal={deal}
        stage={stage}
        onEdit={onEdit}
        onMessage={onMessage}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Message Anil Reddy about this deal',
      })
    );
    expect(onMessage).toHaveBeenCalledWith(deal);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('[PIPE-006] offers no message button for a deal without a contact', () => {
    render(
      <DealCard
        deal={{ ...deal, contact: undefined } as Deal}
        stage={stage}
        onEdit={vi.fn()}
        onMessage={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /^Message/ })).toBeNull();
  });
});
