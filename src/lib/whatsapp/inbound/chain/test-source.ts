import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHAIN_DIR = 'src/lib/whatsapp/inbound/chain';

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

export function inboundStepFiles(): string[] {
  const index = read(`${CHAIN_DIR}/steps/index.ts`);
  return [...index.matchAll(/from '\.\/([a-z-]+)';/g)].map(
    (match) => `${CHAIN_DIR}/steps/${match[1]}.ts`
  );
}

export function inboundStepOrder(): string[] {
  const index = read(`${CHAIN_DIR}/steps/index.ts`);
  return [...index.matchAll(/name: '(\w+)'/g)].map((match) => match[1]);
}

export function inboundChainSource(): string {
  return [`${CHAIN_DIR}/run.ts`, ...inboundStepFiles()].map(read).join('\n');
}

export function inboundStepSource(step: string): string {
  return read(`${CHAIN_DIR}/steps/${step}.ts`);
}
