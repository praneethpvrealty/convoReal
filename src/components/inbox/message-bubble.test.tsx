// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/types';
import { MessageBubble } from './message-bubble';

function imageMessage(): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'customer',
    content_type: 'image',
    media_url: 'https://cdn.example.com/site-plan.jpg',
    status: 'delivered',
    created_at: '2026-11-23T06:45:00.000Z',
  } as Message;
}

function mobileSource(path: string): string {
  return readFileSync(join(process.cwd(), 'mobile', path), 'utf8');
}

describe('chat image viewer [INB-054]', () => {
  afterEach(cleanup);

  it('[INB-054] opens a received image full size when it is clicked on web', async () => {
    render(<MessageBubble message={imageMessage()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View image' }));
    await waitFor(() =>
      expect(screen.getAllByAltText('Shared image')).toHaveLength(2)
    );
    const enlarged = screen.getAllByAltText('Shared image')[1];
    expect(enlarged.className).toContain('object-contain');
    expect(enlarged.getAttribute('src')).toBe(
      'https://cdn.example.com/site-plan.jpg'
    );
  });

  it('[INB-054] keeps right-click and blur in the overlay from reaching the message actions wrapper', async () => {
    const onContextMenu = vi.fn();
    const onBlur = vi.fn();
    render(
      <div onContextMenu={onContextMenu} onBlur={onBlur}>
        <MessageBubble message={imageMessage()} />
      </div>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'View image' }));
    await waitFor(() =>
      expect(screen.getAllByAltText('Shared image')).toHaveLength(2)
    );
    const enlarged = screen.getAllByAltText('Shared image')[1];
    const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
    expect(backdrop).not.toBeNull();
    for (const target of [enlarged, backdrop as Element]) {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      fireEvent.blur(target);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onContextMenu).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();
  });

  it('[INB-054] opens a chat image in the full-screen gallery on mobile and keeps hold-for-actions', () => {
    const image = mobileSource('components/media-image.tsx');
    expect(image).toContain(
      "import { GalleryViewer } from '@/components/gallery-viewer';"
    );
    expect(image).toMatch(/onPress=\{\(\) => setViewerOpen\(true\)\}/);
    expect(image).toMatch(/onLongPress=\{onLongPress\}/);
    expect(image).toMatch(/<GalleryViewer\s+images=\{\[\{ uri \}\]\}/);

    const bubble = mobileSource('components/message-bubble.tsx');
    expect(bubble).toMatch(
      /<MediaImage\s+mediaUrl=\{message\.media_url\}\s+onLongPress=/
    );

    const viewer = mobileSource('components/gallery-viewer.tsx');
    expect(viewer).toContain('resizeMode="contain"');
    expect(viewer).toContain('maximumZoomScale={4}');
  });
});
