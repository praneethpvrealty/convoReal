import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';

export const REVIEWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.go',
  '.sql',
  '.yml',
  '.yaml',
  '.toml',
  '.json',
]);

const SKIPPED_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)npm-shrinkwrap\.json$/,
  /\.gen\.[cm]?[jt]sx?$/,
  /\.test\.[cm]?[jt]sx?$/,
  /\.integration\.test\.[cm]?[jt]sx?$/,
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  /^public\//,
  /^docs\//,
  /(^|\/)node_modules\//,
];

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

export function isReviewed(file) {
  if (file === 'AGENTS.md') return true;
  if (SKIPPED_PATTERNS.some((re) => re.test(file))) return false;
  return REVIEWED_EXTENSIONS.has(path.posix.extname(file));
}

export function selectFiles(nameStatus) {
  const files = [];
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const file = parts[parts.length - 1];
    if (isReviewed(file)) files.push(file);
  }
  return files;
}

export function parseDiff(diff) {
  const index = new Map();
  let file = null;
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const target = raw.slice(4).trim();
      file = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (file) index.set(file, new Set());
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!file || !index.has(file)) continue;
    if (raw.startsWith('\\')) continue;
    if (raw.startsWith('-')) continue;
    if (raw.startsWith('+') || raw.startsWith(' ') || raw === '') {
      index.get(file).add(newLine);
      newLine += 1;
    }
  }
  return index;
}

export function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) return { text: diff, truncated: false };
  const cut = diff.lastIndexOf('\ndiff --git', maxChars);
  const end = cut > maxChars / 2 ? cut : maxChars;
  return {
    text: `${diff.slice(0, end)}\n\n[diff truncated at ${end} of ${diff.length} characters; read the remaining files with read_file]`,
    truncated: true,
  };
}

export function safeRepoPath(root, requested) {
  const resolved = path.resolve(root, requested);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  if (/(^|\/)(node_modules|\.git)(\/|$)/.test(path.relative(root, resolved))) {
    return null;
  }
  return resolved;
}

export function confinedRealPath(root, requested) {
  const resolved = safeRepoPath(root, requested);
  if (!resolved) return null;
  let realRoot;
  let real;
  try {
    realRoot = realpathSync(root);
    real = realpathSync(resolved);
  } catch {
    return null;
  }
  return safeRepoPath(realRoot, real);
}

export function extractHandbookSections(markdown) {
  const ranges = [
    ['### 2.5 ', '### 2.8 '],
    ['### 7.4 ', '## 8. '],
    ['### 8.3 ', '### 8.4 '],
    ['## 10. ', '## 11. '],
    ['## 14. ', '## 15. '],
  ];
  const out = [];
  for (const [start, end] of ranges) {
    const from = markdown.indexOf(`\n${start}`);
    if (from === -1) continue;
    const to = markdown.indexOf(`\n${end}`, from + 1);
    out.push(markdown.slice(from + 1, to === -1 ? undefined : to).trim());
  }
  return out.join('\n\n');
}

export function normalizeSeverity(value) {
  const s = String(value ?? '').toLowerCase();
  return SEVERITIES.includes(s) ? s : 'medium';
}

export function findingKey(finding) {
  const title = String(finding.title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return createHash('sha256')
    .update(`${finding.path}|${title}`)
    .digest('hex')
    .slice(0, 16);
}

export const MARKER_PREFIX = '<!-- claude-security-review:';

export function marker(key) {
  return `${MARKER_PREFIX}${key} -->`;
}

export function markersIn(text) {
  const keys = new Set();
  const re = /<!-- claude-security-review:([0-9a-f]{16}) -->/g;
  let m;
  while ((m = re.exec(text ?? ''))) keys.add(m[1]);
  return keys;
}

const SEVERITY_ICON = {
  critical: '🔴',
  high: '🔴',
  medium: '🟠',
  low: '🟡',
};

export function formatFinding(finding) {
  const severity = normalizeSeverity(finding.severity);
  const lines = [
    `**${SEVERITY_ICON[severity]} ${severity.toUpperCase()} · ${finding.title}**`,
    '',
    finding.detail,
  ];
  if (finding.recommendation) {
    lines.push('', `**Fix:** ${finding.recommendation}`);
  }
  lines.push('', marker(findingKey(finding)));
  return lines.join('\n');
}

export function planComments(findings, diffIndex, existingKeys) {
  const inline = [];
  const outOfDiff = [];
  const alreadyPosted = [];
  const fresh = [];
  const seen = new Set();
  for (const finding of findings) {
    const key = findingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    if (existingKeys.has(key)) {
      alreadyPosted.push(finding);
      continue;
    }
    fresh.push(finding);
    const lines = diffIndex.get(finding.path);
    const line = Number(finding.line) || 0;
    if (lines && line > 0 && lines.has(line)) {
      inline.push({
        path: finding.path,
        line,
        side: 'RIGHT',
        body: formatFinding(finding),
      });
    } else {
      outOfDiff.push(finding);
    }
  }
  return { inline, outOfDiff, alreadyPosted, fresh };
}

export function checkConclusion(findings) {
  if (findings.length === 0) return 'success';
  const worst = findings
    .map((f) => normalizeSeverity(f.severity))
    .sort((a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b))[0];
  return worst === 'critical' || worst === 'high' ? 'failure' : 'neutral';
}

export function summaryMarkdown({
  findings,
  summary,
  model,
  usage,
  alreadyPosted,
}) {
  const lines = [];
  if (findings.length === 0) {
    lines.push('No security findings in this change.');
  } else {
    lines.push(
      `${findings.length} finding${findings.length === 1 ? '' : 's'}:`,
      ''
    );
    for (const f of findings) {
      const where = f.line > 0 ? `${f.path}:${f.line}` : f.path;
      lines.push(
        `- ${SEVERITY_ICON[normalizeSeverity(f.severity)]} **${normalizeSeverity(f.severity)}** \`${where}\` — ${f.title}`
      );
    }
  }
  if (alreadyPosted?.length) {
    lines.push(
      '',
      `${alreadyPosted.length} of these were already posted on an earlier commit and were not repeated.`
    );
  }
  if (summary) lines.push('', summary);
  lines.push(
    '',
    `_Reviewed by ${model}${usage ? ` · ${usage.input} input / ${usage.output} output tokens` : ''}._`
  );
  return lines.join('\n');
}

export function reviewBody({ findings, outOfDiff, summary }) {
  const lines = ['## Claude security review', ''];
  if (findings.length === 0) {
    lines.push('No security findings in this change.');
  } else {
    lines.push(
      `${findings.length} finding${findings.length === 1 ? '' : 's'}. Each one is a claim to verify: fix it, or answer the thread with the reason it does not apply, and resolve the thread before merging.`
    );
  }
  if (outOfDiff.length) {
    lines.push('', '### Outside the diff', '');
    for (const f of outOfDiff) {
      const where = f.line > 0 ? `\`${f.path}:${f.line}\`` : `\`${f.path}\``;
      lines.push(`${where}`, '', formatFinding(f), '');
    }
  }
  if (summary) lines.push('', summary);
  return lines.join('\n');
}
