import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export function advisories(report, minSeverity = 'high') {
  const floor = SEVERITY_RANK[minSeverity];
  const found = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      if ((SEVERITY_RANK[via.severity] ?? -1) < floor) continue;
      const key = `${via.name}:${via.source}`;
      if (found.has(key)) continue;
      found.set(key, {
        name: via.name,
        severity: via.severity,
        title: via.title,
        url: via.url,
      });
    }
  }
  return found;
}

export function newAdvisories(baseReport, headReport, minSeverity = 'high') {
  const base = advisories(baseReport, minSeverity);
  return [...advisories(headReport, minSeverity)]
    .filter(([key]) => !base.has(key))
    .map(([, advisory]) => advisory);
}

export function summarize(label, added, existing) {
  const lines = [`### npm audit: \`${label}\``, ''];
  if (added.length === 0) {
    lines.push(
      `No new high or critical advisory in production dependencies. ${existing} already on the base branch.`
    );
  } else {
    lines.push(
      `${added.length} new high or critical advisory in production dependencies:`,
      ''
    );
    for (const advisory of added) {
      lines.push(
        `- **${advisory.severity}** \`${advisory.name}\`: [${advisory.title}](${advisory.url})`
      );
    }
  }
  return lines.join('\n') + '\n';
}

export function readReport(text) {
  const report = text.trim() ? JSON.parse(text) : {};
  if (report.error) {
    throw new Error(
      `npm audit failed: ${report.error.summary ?? report.error.code}`
    );
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [label, basePath, headPath] = process.argv.slice(2);
  const baseReport = readReport(readFileSync(basePath, 'utf8'));
  const added = newAdvisories(
    baseReport,
    readReport(readFileSync(headPath, 'utf8'))
  );
  const summary = summarize(label, added, advisories(baseReport).size);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  if (added.length > 0) process.exitCode = 1;
}
