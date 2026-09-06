// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ShowcaseShortlist } from './showcase-shortlist';
import { useShowcaseShortlist } from '@/hooks/use-showcase-shortlist';
import { readShortlistIds } from '@/lib/showcase/shortlist';
import type { Property } from '@/types';

const properties = [
  { id: 'one', title: 'First home' },
  { id: 'two', title: 'Second home' },
] as Property[];
function Harness({ accountId = 'account' }: { accountId?: string }) {
  const shortlist = useShowcaseShortlist(accountId, properties);
  return (
    <>
      {properties.map((p) => (
        <button
          key={p.id}
          aria-pressed={shortlist.ids.includes(p.id)}
          onClick={() => shortlist.toggle(p.id)}
        >
          {p.title}
        </button>
      ))}
      <ShowcaseShortlist
        properties={shortlist.selected}
        accountId={accountId}
        name=""
        phone=""
        email=""
        onRemove={shortlist.toggle}
        onClear={shortlist.clear}
      />
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('persists selections per showcase and removes stale stored properties', () => {
  localStorage.setItem(
    'showcase_shortlist:account',
    JSON.stringify(['one', 'gone', 'one'])
  );
  const view = render(<Harness />);
  expect(
    screen
      .getByRole('button', { name: 'First home' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  view.rerender(<Harness accountId="other" />);
  expect(screen.queryByText('1 shortlisted')).toBeNull();
  view.rerender(<Harness />);
  expect(screen.getByText('1 shortlisted')).toBeTruthy();
  expect(readShortlistIds('{broken', ['one'])).toEqual([]);
});

it('sends a single request for the selection and clears only after success', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'First home' }));
  fireEvent.click(screen.getByRole('button', { name: 'Second home' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Enquire about selected' })
  );
  fireEvent.change(screen.getByLabelText('Your name'), {
    target: { value: 'Buyer' },
  });
  fireEvent.change(screen.getByLabelText('Mobile number'), {
    target: { value: '9900277111' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Send enquiry for 2 properties' })
  );
  await screen.findByText('Enquiry sent');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
  ).toMatchObject({
    propertyIds: ['one', 'two'],
    name: 'Buyer',
    accountId: 'account',
  });
  expect(localStorage.getItem('showcase_shortlist:account')).toBe('[]');
});

it('retains the selection on failure and lets visitors remove properties before retry', async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'Please try again' }),
  } as Response);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'First home' }));
  fireEvent.click(screen.getByRole('button', { name: 'Second home' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Enquire about selected' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove Second home from shortlist' })
  );
  fireEvent.change(screen.getByLabelText('Your name'), {
    target: { value: 'Buyer' },
  });
  fireEvent.change(screen.getByLabelText('Mobile number'), {
    target: { value: '9900277111' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Send enquiry for 1 property' })
  );
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe('Please try again')
  );
  expect(localStorage.getItem('showcase_shortlist:account')).toBe('["one"]');
  expect(screen.getByLabelText('Your name').getAttribute('value')).not.toBe('');
});

it('keeps shortlisting usable when browser storage is blocked', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  render(<Harness accountId="blocked-storage" />);
  fireEvent.click(screen.getByRole('button', { name: 'First home' }));
  fireEvent.click(screen.getByRole('button', { name: 'Second home' }));
  expect(screen.getByText('2 shortlisted')).toBeTruthy();
});
