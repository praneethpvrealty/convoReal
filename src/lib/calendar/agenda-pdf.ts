import {
  PDFDocument,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

import { agendaItemTitle, callablePhone } from '@/lib/calendar/agenda-format';
import type {
  DailyAgenda,
  DailyAgendaEvent,
  DailyAgendaTodo,
} from '@/lib/calendar/daily-agenda';

interface AgendaPdfOptions {
  memberName: string | null;
  accountName: string | null;
  generatedAt?: Date;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 36;

const BRAND = rgb(0.486, 0.227, 0.929);
const BRAND_SOFT = rgb(0.953, 0.929, 0.996);
const INK = rgb(0.067, 0.094, 0.153);
const MUTED = rgb(0.392, 0.455, 0.545);
const RULE = rgb(0.886, 0.91, 0.941);
const DANGER = rgb(0.863, 0.149, 0.149);
const DANGER_SOFT = rgb(0.996, 0.886, 0.886);
const LINK = rgb(0.031, 0.494, 0.373);

const EVENT_TYPE_LABEL: Record<string, string> = {
  site_visit: 'Site visit',
  call: 'Call',
  follow_up: 'Follow-up',
  document: 'Documents',
  meeting: 'Meeting',
  other: 'Event',
};

function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function istShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
  });
}

class Writer {
  private page!: PDFPage;
  private y = 0;
  readonly pages: PDFPage[] = [];
  private readonly charset: Set<number>;

  constructor(
    private readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont
  ) {
    this.charset = new Set(regular.getCharacterSet());
    this.newPage();
  }

  clean(text: string): string {
    let out = '';
    for (const ch of text.replace(/\s+/g, ' ')) {
      const cp = ch.codePointAt(0) ?? 0;
      if (this.charset.has(cp)) out += ch;
    }
    return out.replace(/\s{2,}/g, ' ').trim();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  get cursor() {
    return this.y;
  }

  get current() {
    return this.page;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_H) this.newPage();
  }

  move(dy: number) {
    this.y -= dy;
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = this.clean(text).split(' ').filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (
          cut > 1 &&
          font.widthOfTextAtSize(line.slice(0, cut), size) > width
        ) {
          cut--;
        }
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  text(
    value: string,
    x: number,
    y: number,
    font: PDFFont,
    size: number,
    color: RGB
  ) {
    const clean = this.clean(value);
    if (clean) this.page.drawText(clean, { x, y, font, size, color });
    return font.widthOfTextAtSize(clean, size);
  }

  link(x: number, y: number, width: number, height: number, uri: string) {
    const annot = this.doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x, y, x + width, y + height],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
    });
    const ref = this.doc.context.register(annot);
    this.page.node.addAnnot(ref);
  }
}

function drawHeader(
  w: Writer,
  agenda: DailyAgenda,
  options: AgendaPdfOptions,
  counts: { events: number; dated: number; undated: number }
) {
  const bandH = 104;
  w.current.drawRectangle({
    x: 0,
    y: PAGE_H - bandH,
    width: PAGE_W,
    height: bandH,
    color: BRAND,
  });
  const white = rgb(1, 1, 1);
  w.text('DAILY AGENDA', MARGIN, PAGE_H - 34, w.bold, 9, rgb(0.86, 0.8, 1));
  w.text(agenda.label, MARGIN, PAGE_H - 60, w.bold, 22, white);
  const who = [options.memberName, options.accountName]
    .filter(Boolean)
    .join(' · ');
  if (who) w.text(who, MARGIN, PAGE_H - 82, w.regular, 10, rgb(0.93, 0.9, 1));

  w.move(bandH - MARGIN + 22);

  const chips = [
    `${counts.events} appointment${counts.events === 1 ? '' : 's'}`,
    `${counts.dated} task${counts.dated === 1 ? '' : 's'} due`,
    counts.undated > 0 ? `${counts.undated} with no date` : null,
  ].filter((c): c is string => !!c);
  let x = MARGIN;
  for (const chip of chips) {
    const tw = w.bold.widthOfTextAtSize(chip, 9);
    w.current.drawRectangle({
      x,
      y: w.cursor - 6,
      width: tw + 16,
      height: 20,
      color: BRAND_SOFT,
    });
    w.text(chip, x + 8, w.cursor, w.bold, 9, BRAND);
    x += tw + 24;
  }
  w.move(30);
}

function drawSection(w: Writer, title: string, count: number) {
  w.ensure(48);
  w.move(10);
  const tw = w.text(title.toUpperCase(), MARGIN, w.cursor, w.bold, 10, BRAND);
  w.text(`${count}`, MARGIN + tw + 8, w.cursor, w.bold, 10, MUTED);
  w.move(8);
  w.current.drawLine({
    start: { x: MARGIN, y: w.cursor },
    end: { x: MARGIN + CONTENT_W, y: w.cursor },
    thickness: 1,
    color: RULE,
  });
  w.move(18);
}

function drawContact(
  w: Writer,
  x: number,
  contact: DailyAgendaTodo['contact']
) {
  if (!contact) return false;
  const name = contact.name?.trim() || '';
  const phone = callablePhone(contact.phone);
  if (!name && !phone) return false;
  let cx = x;
  if (name) {
    cx += w.text(name, cx, w.cursor, w.regular, 9.5, MUTED);
    if (phone) cx += w.text('·', cx + 6, w.cursor, w.regular, 9.5, MUTED) + 12;
  }
  if (phone) {
    const pw = w.text(`Call ${phone}`, cx, w.cursor, w.bold, 9.5, LINK);
    w.current.drawLine({
      start: { x: cx, y: w.cursor - 1.5 },
      end: { x: cx + pw, y: w.cursor - 1.5 },
      thickness: 0.5,
      color: LINK,
    });
    w.link(cx, w.cursor - 3, pw, 13, `tel:${phone}`);
  }
  return true;
}

function drawEvent(w: Writer, ev: DailyAgendaEvent) {
  const textX = MARGIN + 78;
  const width = CONTENT_W - 78;
  const titleLines = w.wrap(ev.title, w.bold, 11, width);
  const height =
    titleLines.length * 15 +
    (ev.contact ? 15 : 0) +
    (ev.location ? 15 : 0) +
    14;
  w.ensure(height);

  const done = ev.status === 'completed';
  w.text(
    istTime(ev.startTime),
    MARGIN,
    w.cursor,
    w.bold,
    11,
    done ? MUTED : INK
  );
  w.text(
    EVENT_TYPE_LABEL[ev.eventType || 'other'] || 'Event',
    MARGIN,
    w.cursor - 14,
    w.regular,
    8.5,
    MUTED
  );
  const top = w.cursor;
  for (const line of titleLines) {
    w.text(line, textX, w.cursor, w.bold, 11, done ? MUTED : INK);
    w.move(15);
  }
  if (drawContact(w, textX, ev.contact)) w.move(15);
  if (ev.location) {
    w.text(`Location: ${ev.location}`, textX, w.cursor, w.regular, 9.5, MUTED);
    w.move(15);
  }
  if (done) {
    w.text('DONE', MARGIN + CONTENT_W - 30, top, w.bold, 8, LINK);
  }
  w.move(10);
}

function drawTodo(w: Writer, todo: DailyAgendaTodo, dayStartIso: string) {
  const textX = MARGIN + 22;
  const high = todo.priority === 'high';
  const badgeW = high ? 34 : 0;
  const width = CONTENT_W - 22 - (badgeW ? badgeW + 8 : 0);
  const title = agendaItemTitle(todo.title, todo.contact);
  const titleLines = w.wrap(title, high ? w.bold : w.regular, 11, width);
  const overdue = !!todo.dueDate && todo.dueDate < dayStartIso;
  const height =
    titleLines.length * 15 + (todo.contact ? 15 : 0) + (overdue ? 13 : 0) + 12;
  w.ensure(height);

  w.current.drawRectangle({
    x: MARGIN,
    y: w.cursor - 2,
    width: 11,
    height: 11,
    borderColor: high ? DANGER : MUTED,
    borderWidth: 1,
  });
  if (high) {
    w.current.drawRectangle({
      x: MARGIN + CONTENT_W - badgeW,
      y: w.cursor - 3,
      width: badgeW,
      height: 13,
      color: DANGER_SOFT,
    });
    w.text(
      'HIGH',
      MARGIN + CONTENT_W - badgeW + 7,
      w.cursor,
      w.bold,
      7.5,
      DANGER
    );
  }
  for (const line of titleLines) {
    w.text(line, textX, w.cursor, high ? w.bold : w.regular, 11, INK);
    w.move(15);
  }
  if (drawContact(w, textX, todo.contact)) w.move(15);
  if (overdue && todo.dueDate) {
    w.text(
      `Overdue since ${istShortDate(todo.dueDate)}`,
      textX,
      w.cursor + 2,
      w.regular,
      8.5,
      DANGER
    );
    w.move(13);
  }
  w.move(9);
}

function drawFooters(w: Writer, generatedAt: Date) {
  const stamp = generatedAt.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 14 },
      end: { x: PAGE_W - MARGIN, y: MARGIN + 14 },
      thickness: 0.5,
      color: RULE,
    });
    page.drawText(w.clean(`ConvoReal · generated ${stamp} IST`), {
      x: MARGIN,
      y: MARGIN,
      font: w.regular,
      size: 8,
      color: MUTED,
    });
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, {
      x: PAGE_W - MARGIN - w.regular.widthOfTextAtSize(label, 8),
      y: MARGIN,
      font: w.regular,
      size: 8,
      color: MUTED,
    });
  });
}

export async function buildAgendaPdf(
  agenda: DailyAgenda,
  options: AgendaPdfOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Agenda — ${agenda.label}`);
  doc.setCreator('ConvoReal');
  doc.setProducer('ConvoReal');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, regular, bold);
  const dayStartIso = new Date(`${agenda.date}T00:00:00+05:30`).toISOString();

  drawHeader(w, agenda, options, {
    events: agenda.events.length,
    dated: agenda.dated.length,
    undated: agenda.undated.length,
  });

  if (
    agenda.events.length === 0 &&
    agenda.dated.length === 0 &&
    agenda.undated.length === 0
  ) {
    w.move(20);
    w.text(
      'Nothing scheduled for this day.',
      MARGIN,
      w.cursor,
      regular,
      12,
      MUTED
    );
  }

  if (agenda.events.length > 0) {
    drawSection(w, 'Appointments', agenda.events.length);
    for (const ev of agenda.events) drawEvent(w, ev);
  }
  if (agenda.dated.length > 0) {
    drawSection(w, 'Tasks due', agenda.dated.length);
    for (const t of agenda.dated) drawTodo(w, t, dayStartIso);
  }
  if (agenda.undated.length > 0) {
    drawSection(w, 'No date set', agenda.undated.length);
    for (const t of agenda.undated) drawTodo(w, t, dayStartIso);
  }

  drawFooters(w, options.generatedAt ?? new Date());
  return doc.save();
}
