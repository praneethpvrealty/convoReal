import { Fragment, type ReactNode } from 'react';
import {
  parseWhatsAppFormatting,
  type TextSegment,
} from '@/lib/conversations/text-format';

function wrap(segment: TextSegment): ReactNode {
  let node: ReactNode = segment.text;
  if (segment.mono)
    node = (
      <code className="rounded bg-black/20 px-1 font-mono text-[0.85em]">
        {node}
      </code>
    );
  if (segment.strike) node = <s>{node}</s>;
  if (segment.italic) node = <em>{node}</em>;
  if (segment.bold) node = <strong className="font-semibold">{node}</strong>;
  return node;
}

export function FormattedText({ text }: { text: string }) {
  return (
    <>
      {parseWhatsAppFormatting(text).map((segment, i) => (
        <Fragment key={i}>{wrap(segment)}</Fragment>
      ))}
    </>
  );
}
