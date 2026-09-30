import { describe, expect, it } from 'vitest';
import {
  advisories,
  newAdvisories,
  readReport,
  summarize,
} from './audit-new-advisories.mjs';

const via = (name: string, source: number, severity: string) => ({
  name,
  source,
  severity,
  title: `${name} advisory ${source}`,
  url: `https://github.com/advisories/${source}`,
});

const report = (...entries: ReturnType<typeof via>[]) => ({
  vulnerabilities: Object.fromEntries(
    entries.map((entry) => [entry.name, { name: entry.name, via: [entry] }])
  ),
});

describe('advisories', () => {
  it('keeps high and critical advisories and drops lower ones', () => {
    const found = advisories(
      report(
        via('a', 1, 'critical'),
        via('b', 2, 'high'),
        via('c', 3, 'moderate'),
        via('d', 4, 'low')
      )
    );
    expect([...found.keys()]).toEqual(['a:1', 'b:2']);
  });

  it('ignores transitive references that only name another package', () => {
    const found = advisories({
      vulnerabilities: {
        parent: { name: 'parent', via: ['child'] },
        child: { name: 'child', via: [via('child', 9, 'high')] },
      },
    });
    expect([...found.keys()]).toEqual(['child:9']);
  });

  it('counts an advisory once when several packages carry it', () => {
    const shared = via('shared', 5, 'high');
    const found = advisories({
      vulnerabilities: {
        x: { name: 'x', via: [shared] },
        y: { name: 'y', via: [shared] },
      },
    });
    expect(found.size).toBe(1);
  });

  it('treats an empty or missing report as clean', () => {
    expect(advisories({}).size).toBe(0);
    expect(advisories(undefined).size).toBe(0);
  });
});

describe('newAdvisories', () => {
  it('reports only advisories the head adds over the base', () => {
    const base = report(via('old', 1, 'high'));
    const head = report(via('old', 1, 'high'), via('added', 2, 'critical'));
    expect(newAdvisories(base, head).map((a) => a.name)).toEqual(['added']);
  });

  it('passes when the head fixes or keeps existing advisories', () => {
    const base = report(via('old', 1, 'high'), via('fixed', 2, 'high'));
    const head = report(via('old', 1, 'high'));
    expect(newAdvisories(base, head)).toEqual([]);
  });

  it('flags a new advisory on a package the base already had', () => {
    const base = report(via('pkg', 1, 'high'));
    const head = report(via('pkg', 1, 'high'), via('pkg', 2, 'high'));
    expect(newAdvisories(base, head).map((a) => a.url)).toEqual([
      'https://github.com/advisories/2',
    ]);
  });

  it('ignores a new moderate advisory', () => {
    expect(newAdvisories({}, report(via('m', 1, 'moderate')))).toEqual([]);
  });
});

describe('summarize', () => {
  it('lists each new advisory', () => {
    const text = summarize('mobile', [via('pkg', 7, 'critical')], 3);
    expect(text).toContain('1 new high or critical advisory');
    expect(text).toContain('`pkg`');
    expect(text).toContain('https://github.com/advisories/7');
  });

  it('says how many were already on the base when nothing is new', () => {
    expect(summarize('.', [], 4)).toContain('4 already on the base branch');
  });
});

describe('readReport', () => {
  it('reads an empty file as a clean report', () => {
    expect(readReport('')).toEqual({});
  });

  it('fails when npm audit itself failed rather than reporting clean', () => {
    const failed = JSON.stringify({
      error: { code: 'ENOLOCK', summary: 'This command requires a lockfile' },
    });
    expect(() => readReport(failed)).toThrow(
      'This command requires a lockfile'
    );
  });
});
