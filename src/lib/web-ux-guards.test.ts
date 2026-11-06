import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function webSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8');
}

describe('[UIX-050] appointment forms keep end after start and save once', () => {
  it('validates, shifts the end with the start and holds Save while saving', () => {
    const calendar = webSource('app/(dashboard)/calendar/page.tsx');
    expect(calendar).toContain('eventTimesError(startDate, endDate)');
    expect(calendar).toContain(
      'movedEventEnd(apptStartTime, apptEndTime, nextStart)'
    );
    expect(calendar).toContain('onChange={changeApptStart}');
    expect(calendar).toContain('if (apptSaving) return;');
    expect(calendar).toContain(
      'disabled={apptSaving || Boolean(apptTimesError)}'
    );

    const dialog = webSource('components/calendar/schedule-dialog.tsx');
    expect(dialog).toContain('movedEventEnd(startTime, endTime, nextStart)');
    expect(dialog).toContain('onChange={changeStart}');
    expect(dialog).toContain('disabled={loading || Boolean(timesError)}');
  });
});

describe('[UIX-053] web screens show a retry instead of an empty or endless state', () => {
  it('dashboard panels swap their skeleton for a retry on failure', () => {
    const dashboard = webSource(
      'app/(dashboard)/dashboard/dashboard-content.tsx'
    );
    for (const query of [
      'metricsQuery',
      'seriesQuery',
      'pipelineQuery',
      'responseTimeQuery',
      'workloadQuery',
      'activityQuery',
    ]) {
      expect(dashboard).toContain(`failed(${query})`);
    }
    expect(dashboard).toContain('query.isError && query.data === undefined');
  });

  it('a WhatsApp config load error is not shown as disconnected', () => {
    const config = webSource('components/settings/whatsapp-config.tsx');
    expect(config).toMatch(
      /if \(error\) \{\s*console\.error\('Failed to load config row:', error\);\s*setLoadFailed\(true\);\s*return;/
    );
    expect(config).toContain('what="your WhatsApp configuration"');
    expect(config).toContain("setConnectionStatus('unknown');");
    expect(config).toContain("'Connection status unknown'");
    expect(config).toMatch(
      /!payload \|\|\s*!res\.ok \|\|\s*payload\.reason === 'db_error' \|\|\s*payload\.reason === 'unknown'/
    );
  });

  it('Today shows the insights retry only for a range that can be retried', () => {
    const today = webSource('app/(dashboard)/today/today-content.tsx');
    expect(today).toMatch(
      /failed\.insights &&\s*!insightsLoading &&\s*resolveRange\(rangePreset, customStart, customEnd\)/
    );
  });

  it('header search and verify-phone report failures with a retry', () => {
    const header = webSource('components/layout/header.tsx');
    expect(header).toContain('setSearchFailed(Boolean(failure))');
    expect(header).toContain('!searchFailed &&');

    const verify = webSource('app/verify-phone/page.tsx');
    expect(verify).toContain('setLoadFailed(true)');
    expect(verify).toContain('what="your verification details"');
  });

  it('automation save surfaces a network failure', () => {
    const builder = webSource('components/automations/automation-builder.tsx');
    expect(builder).toMatch(
      /\} catch \(err\) \{\s*console\.error\('\[automations\] save failed:', err\);\s*toast\.error\(/
    );
  });

  it('credit breakdown and top-up never read 0 on failure', () => {
    const breakdown = webSource('components/settings/credit-breakdown.tsx');
    expect(breakdown).not.toContain('setSpentThisMonth(0)');
    expect(breakdown).toContain('what="your credit balance"');

    const topup = webSource('components/settings/credit-topup.tsx');
    expect(topup).toContain('setBuyError(`Top-up failed: ${msg}`)');
    expect(topup).toContain('what="credit packages"');
  });
});

describe('[UIX-056] unsaved work asks before it is thrown away', () => {
  it('the broadcast wizard has no lossy draft and confirms leaving with content', () => {
    const wizard = webSource('app/(dashboard)/broadcasts/new/page.tsx');
    expect(wizard).not.toContain('handleSaveDraft');
    expect(wizard).toContain("window.addEventListener('beforeunload'");
    expect(wizard).toContain('onBack={leaveWizard}');
    expect(
      webSource('components/broadcasts/step4-schedule-send.tsx')
    ).not.toContain('Save as Draft');
  });

  it('the greeting composer and editor confirm discarding', () => {
    const greetings = webSource(
      'app/(dashboard)/broadcasts/greetings-content.tsx'
    );
    expect(greetings).toContain('window.confirm(DISCARD_GREETING_DRAFT)');
    expect(greetings).toContain('window.confirm(DISCARD_GREETING_CHANGES)');
    expect(greetings.match(/onClick=\{requestClose\}/g)?.length).toBe(2);
  });
});

describe('[UIX-037] closing records keep loaded rows through a failed refetch', () => {
  it('shows the records error only when no rows have loaded', () => {
    const index = webSource('components/deals/transaction-workspace-index.tsx');
    expect(index).toContain('isError && rows.length === 0 ?');
  });
});

describe('[UIX-044] a refused share save falls back at once', () => {
  it('does not retry the share-instance save', () => {
    const dialog = webSource('components/inventory/showcase-share-dialog.tsx');
    expect(dialog).toMatch(
      /queryKey: \['showcase-share-instance'[\s\S]{0,300}retry: false,/
    );
  });
});
