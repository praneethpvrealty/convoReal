// Minimal PASS/FAIL recorder. Not vitest: these suites drive a real
// browser against a real account and are run on demand, not in CI,
// so the value is a readable transcript rather than a runner.

const results = [];

export function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  return Boolean(pass);
}

export function summary() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
  for (const r of failed) console.log(' FAILED:', r.name, '|', r.detail);
  return failed.length === 0;
}
