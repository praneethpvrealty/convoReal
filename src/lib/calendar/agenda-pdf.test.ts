import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { buildAgendaPdf } from './agenda-pdf';
import type { DailyAgenda } from './daily-agenda';

function agenda(todoCount: number): DailyAgenda {
  return {
    date: '2026-11-04',
    label: 'Wednesday, 4 November 2026',
    events: [
      {
        title: 'Site visit — Bilekahalli 60x40 🏡',
        eventType: 'site_visit',
        startTime: '2026-11-04T05:30:00.000Z',
        location: 'Bannerghatta Road',
        status: 'scheduled',
        contact: { name: 'Anil Reddy', phone: '919845012345' },
      },
    ],
    dated: Array.from({ length: todoCount }, (_, i) => ({
      title: `New Buyer Requirements - @ನಾಗರಾಜ್ ${i} 🔴`,
      priority: i % 3 === 0 ? 'high' : 'medium',
      dueDate:
        i % 2 === 0 ? '2026-11-02T06:00:00.000Z' : '2026-11-04T06:00:00.000Z',
      contact: { name: `Contact ${i}`, phone: '9845012345' },
    })),
    undated: [
      {
        title: 'Follow up with Kusumaraju’s advocate',
        priority: 'medium',
        dueDate: null,
        contact: null,
      },
    ],
  };
}

describe('[CAL-017] agenda PDF', () => {
  it('renders text the standard font cannot draw without throwing', async () => {
    const bytes = await buildAgendaPdf(agenda(3), {
      memberName: 'Praneeth',
      accountName: 'Yavarta Realty',
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('makes each contact phone a tap-to-call link', async () => {
    const bytes = await buildAgendaPdf(agenda(2), {
      memberName: null,
      accountName: null,
    });
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.Annots();
    const uris = (annots?.asArray() ?? []).map((ref) => {
      const annot = doc.context.lookup(ref, PDFDict);
      const action = annot.lookup(PDFName.of('A'), PDFDict);
      return action.lookup(PDFName.of('URI'), PDFString).decodeText();
    });
    expect(uris).toHaveLength(3);
    expect(uris).toContain('tel:+919845012345');
  });

  it('flows a long list onto more pages', async () => {
    const bytes = await buildAgendaPdf(agenda(80), {
      memberName: 'Praneeth',
      accountName: null,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
