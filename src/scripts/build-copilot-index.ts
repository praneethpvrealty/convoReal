import fs from 'fs';
import path from 'path';

/**
 * Regenerates src/lib/copilot/knowledge-index.gen.ts — the semantic
 * retrieval index for the copilot knowledge corpus.
 *
 *   npm run copilot:index
 *
 * Incremental: chunks whose content hash matches their existing index
 * entry keep their vector, so re-runs only embed what changed. Run it
 * after any chunks.ts edit and commit the regenerated file; the
 * freshness test in chunks.test.ts fails CI while the two disagree.
 */

function loadEnv() {
  const files = ['.env.local', '.env.development', '.env'];
  for (const file of files) {
    const envPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIdx = trimmed.indexOf('=');
      if (equalsIdx === -1) continue;
      const key = trimmed.substring(0, equalsIdx).trim();
      const value = trimmed
        .substring(equalsIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is required (set it in .env.local).');
    process.exit(1);
  }

  const { CHUNKS, chunkVersion } = await import('../lib/copilot/chunks');
  const { KNOWLEDGE_INDEX } =
    await import('../lib/copilot/knowledge-index.gen');
  const { embedText } = await import('../lib/ai/gemini');

  const entries: Record<string, { v: string; embedding: number[] }> = {};
  let reused = 0;
  let embedded = 0;

  for (const chunk of CHUNKS) {
    const v = chunkVersion(chunk);
    const existing = KNOWLEDGE_INDEX[chunk.id];
    if (existing && existing.v === v) {
      entries[chunk.id] = existing;
      reused++;
      continue;
    }
    const text = [chunk.title, chunk.body, (chunk.keywords ?? []).join(' ')]
      .filter(Boolean)
      .join('\n');
    const embedding = (await embedText(text)).map(
      (x) => Math.round(x * 100000) / 100000
    );
    entries[chunk.id] = { v, embedding };
    embedded++;
    console.log(`embedded ${chunk.id}`);
  }

  const pruned = Object.keys(KNOWLEDGE_INDEX).filter((id) => !entries[id]);

  const header = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Semantic retrieval index for the copilot knowledge corpus: one
 * 768-dim gemini-embedding-001 vector per chunk, keyed by chunk id
 * and stamped with the chunk's content version. Regenerate after any
 * chunks.ts edit with:
 *
 *   npm run copilot:index   (needs GEMINI_API_KEY in .env.local)
 *
 * While empty (or for chunks missing/stale here), retrieval.ts falls
 * back to lexical keyword scoring, so the helper keeps working on
 * deployments that never run the script.
 */

export const KNOWLEDGE_INDEX: Record<
  string,
  { v: string; embedding: number[] }
> = `;

  const sorted = Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))
  );
  const outPath = path.resolve(
    process.cwd(),
    'src/lib/copilot/knowledge-index.gen.ts'
  );
  fs.writeFileSync(outPath, `${header}${JSON.stringify(sorted)};\n`);

  console.log(
    `\n${embedded} embedded, ${reused} reused, ${pruned.length} pruned → ${outPath}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
