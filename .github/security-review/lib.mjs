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
    ['### 2.1 ', '### 2.5 '],
    ['### 2.5 ', '## 3. '],
    ['### 7.1 ', '### 7.3 '],
    ['### 7.4 ', '## 8. '],
    ['### 8.3 ', '### 8.4 '],
    ['## 10. ', '## 11. '],
    ['## 12. ', '## 13. '],
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

export const MARKER_PREFIX = '<!-- claude-review:';

export function marker(key) {
  return `${MARKER_PREFIX}${key} -->`;
}

export function markersIn(text) {
  const keys = new Set();
  const re = /<!-- claude-(?:security-)?review:([0-9a-f]{16}) -->/g;
  let m;
  while ((m = re.exec(text ?? ''))) keys.add(m[1]);
  return keys;
}

export const KINDS = ['security', 'code'];

export function normalizeKind(value) {
  const k = String(value ?? '').toLowerCase();
  return KINDS.includes(k) ? k : 'security';
}

export function splitByKind(findings) {
  const out = { security: [], code: [] };
  for (const f of findings) out[normalizeKind(f.kind)].push(f);
  return out;
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
    `**${SEVERITY_ICON[severity]} ${severity.toUpperCase()} · [${normalizeKind(finding.kind)}] ${finding.title}**`,
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

function summaryLine(f) {
  const where = f.line > 0 ? `${f.path}:${f.line}` : f.path;
  return `- ${SEVERITY_ICON[normalizeSeverity(f.severity)]} **${normalizeSeverity(f.severity)}** \`${where}\` — ${f.title}`;
}

export function summaryMarkdown({
  findings,
  kind = 'security',
  summary,
  model,
  plan,
  usage,
  alreadyPosted,
  carried = [],
  carriedFrom,
}) {
  const lines = [];
  if (findings.length === 0) {
    lines.push(`No ${kind} findings in this change.`);
  } else {
    lines.push(
      `${findings.length} finding${findings.length === 1 ? '' : 's'}:`,
      ''
    );
    for (const f of findings) lines.push(summaryLine(f));
  }
  if (carried.length) {
    lines.push(
      '',
      `${carried.length} finding${carried.length === 1 ? '' : 's'} carried over from ${String(carriedFrom ?? '').slice(0, 7)}, in files this push did not change:`,
      ''
    );
    for (const f of carried) lines.push(summaryLine(f));
  }
  if (alreadyPosted?.length) {
    lines.push(
      '',
      `${alreadyPosted.length} of these were already posted on an earlier commit and were not repeated.`
    );
  }
  if (summary) lines.push('', summary);
  lines.push('', reviewFooter({ model, plan, usage }));
  return lines.join('\n');
}

export function reviewFooter({ model, plan, usage }) {
  const parts = [`Reviewed by ${model}`];
  if (plan) parts.push(`${plan.tier} tier: ${plan.reasons.join(', ')}`);
  if (usage) {
    const read = usage.cacheRead ? ` (${usage.cacheRead} from cache)` : '';
    parts.push(
      `${usage.input + usage.cacheRead + usage.cacheCreation} input${read} / ${usage.output} output tokens`
    );
    const cost = estimateCost(model, usage);
    if (cost !== null) parts.push(`≈ $${cost.toFixed(2)}`);
  }
  return `_${parts.join(' · ')}._`;
}

export function reviewBody({ findings, outOfDiff, summary, footer }) {
  const lines = ['## Claude review', ''];
  const byKind = splitByKind(findings);
  const counts = KINDS.filter((k) => byKind[k].length > 0).map(
    (k) => `${byKind[k].length} ${k}`
  );
  if (findings.length === 0) {
    lines.push('No findings in this change.');
  } else {
    lines.push(
      `${counts.join(' and ')} finding${findings.length === 1 ? '' : 's'}. Each one is a claim to verify: fix it, or answer the thread with the reason it does not apply, and resolve the thread before merging.`
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
  if (footer) lines.push('', footer);
  return lines.join('\n');
}

export const MODELS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

const PRICES_PER_MILLION = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function estimateCost(model, usage) {
  const price = PRICES_PER_MILLION[model];
  if (!price) return null;
  return (
    (usage.input * price.input +
      usage.cacheCreation * price.input * 1.25 +
      usage.cacheRead * price.cacheRead +
      usage.output * price.output) /
    1_000_000
  );
}

export const SENSITIVE_PATTERNS = [
  /^src\/lib\/auth\//,
  /^src\/lib\/supabase\//,
  /^src\/lib\/v1\//,
  /^src\/proxy\.ts$/,
  /^supabase\/migrations\//,
  /^src\/app\/api\/(public|v1|den|buyer|webhooks)\//,
  /^src\/app\/api\/(auth|billing|credits|admin|whatsapp)\//,
  /^src\/app\/api\/.*cron/,
  /^src\/app\/api\/.*webhook/,
  /^src\/app\/api\/whatsapp\/flows\/endpoint\//,
  /^src\/lib\/whatsapp\/(webhook-|encryption|flow-crypto|meta-api|template-)/,
  /^src\/lib\/(den|buyer|billing|credits|marketplace|rate-limit)/,
  /^src\/lib\/inbound\//,
  /^src\/scripts\/queue-worker\.ts$/,
  /^go-ingress\//,
  /^\.github\//,
  /^(next\.config\.ts|vercel\.json|Dockerfile.*)$/,
];

export const SENSITIVE_DIFF_PATTERN =
  /SECURITY DEFINER|service_role|SUPABASE_SERVICE_ROLE_KEY|ENCRYPTION_KEY|META_APP_SECRET|requirePlatformAdmin|withApiKeyAuth|withDenAuth|withBuyerAuth|is_account_(member|writer)|CREATE POLICY|ALTER POLICY/;

export const SERVICE_ROLE_DIFF_PATTERN = /supabaseAdmin\(/;

const LARGE_DIFF_CHARS = 40_000;
const LARGE_FILE_COUNT = 15;
const SMALL_DIFF_CHARS = 3_000;
const SMALL_FILE_COUNT = 3;

export function checkExternalId(prNumber) {
  return `pr-${prNumber}`;
}

export function isCompletedReviewRun(run, prNumber) {
  return (
    run?.status === 'completed' &&
    ['success', 'neutral', 'failure', 'skipped'].includes(run.conclusion) &&
    run.output?.title !== 'Review did not complete' &&
    run.external_id === checkExternalId(prNumber)
  );
}

const SUMMARY_FINDING_LINE =
  /^- \S+ \*\*(critical|high|medium|low)\*\* `(.+?)(?::(\d+))?` — (.+)$/;

export function parseSummaryFindings(summary) {
  const out = [];
  for (const line of String(summary ?? '').split('\n')) {
    const m = SUMMARY_FINDING_LINE.exec(line);
    if (m) {
      out.push({
        severity: m[1],
        path: m[2],
        line: Number(m[3] || 0),
        title: m[4],
      });
    }
  }
  return out;
}

export function carriedFindings(summary, scope, fresh) {
  const inScope = new Set(scope);
  const seen = new Set(fresh.map(findingKey));
  return parseSummaryFindings(summary).filter((f) => {
    if (inScope.has(f.path) || seen.has(findingKey(f))) return false;
    seen.add(findingKey(f));
    return true;
  });
}

export function rereviewFiles(allFiles, changedSince) {
  const changed = new Set(changedSince);
  return allFiles.filter((f) => changed.has(f));
}

export function planModel({
  files,
  diffChars,
  diffText = '',
  override,
  rereviewOf,
}) {
  if (override && override !== 'auto') {
    const model = MODELS[override] ?? override;
    return {
      tier: 'forced',
      model,
      effort: 'high',
      reasons: [`${override} requested`],
    };
  }
  const sensitive = files.filter((f) =>
    SENSITIVE_PATTERNS.some((re) => re.test(f))
  );
  const reasons = [];
  if (rereviewOf) {
    reasons.push(
      `re-review of ${files.length} file${files.length === 1 ? '' : 's'} changed since ${rereviewOf.slice(0, 7)}`
    );
  }
  if (sensitive.length) {
    reasons.push(
      `${sensitive.length} sensitive path${sensitive.length === 1 ? '' : 's'} (${sensitive.slice(0, 3).join(', ')}${sensitive.length > 3 ? ', …' : ''})`
    );
  }
  if (SENSITIVE_DIFF_PATTERN.test(diffText)) {
    reasons.push('auth, policy or secret code in the diff');
  }
  if (diffChars > LARGE_DIFF_CHARS)
    reasons.push(`${Math.round(diffChars / 1000)}k-char diff`);
  if (files.length > LARGE_FILE_COUNT) reasons.push(`${files.length} files`);
  if (reasons.length > (rereviewOf ? 1 : 0)) {
    return { tier: 'deep', model: MODELS.opus, effort: 'high', reasons };
  }
  if (rereviewOf) {
    return { tier: 'rereview', model: MODELS.sonnet, effort: 'high', reasons };
  }
  const routes = files.filter((f) =>
    /(^|\/)(route|page|layout|proxy)\.tsx?$/.test(f)
  );
  const serviceRole = SERVICE_ROLE_DIFF_PATTERN.test(diffText);
  if (
    diffChars <= SMALL_DIFF_CHARS &&
    files.length <= SMALL_FILE_COUNT &&
    routes.length === 0 &&
    !serviceRole
  ) {
    return {
      tier: 'light',
      model: MODELS.haiku,
      effort: 'high',
      reasons: [
        `${diffChars}-char diff across ${files.length} file${files.length === 1 ? '' : 's'}, no sensitive paths`,
      ],
    };
  }
  return {
    tier: 'standard',
    model: MODELS.sonnet,
    effort: 'high',
    reasons: [
      `${Math.round(diffChars / 1000)}k-char diff across ${files.length} file${files.length === 1 ? '' : 's'}, no sensitive paths${serviceRole ? ', service-role query in the diff' : ''}`,
    ],
  };
}
