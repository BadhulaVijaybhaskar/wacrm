// Compare a vitest JSON report against a list of known baseline failures.
// Usage: node check-known-failures.mjs <vitest-results.json> <known-failures.txt> [vitest.log]
// With a log, also fails on missing log or any "Unhandled Error/Rejection" line.
// Exits 1 on new failures, a missing/unparsable report, or zero tests.
import fs from 'node:fs';
import path from 'node:path';

const [reportPath, knownPath, logPath] = process.argv.slice(2);
const gha = Boolean(process.env.GITHUB_ACTIONS);

function error(msg) {
  console.error(gha ? `::error::${msg}` : `ERROR: ${msg}`);
}
function notice(msg) {
  console.log(gha ? `::notice::${msg}` : `NOTICE: ${msg}`);
}

if (!reportPath || !knownPath) {
  error('Usage: check-known-failures.mjs <vitest-results.json> <known-failures.txt>');
  process.exit(1);
}

if (logPath) {
  let log;
  try {
    log = fs.readFileSync(logPath, 'utf8');
  } catch (err) {
    error(`Cannot read vitest log "${logPath}": ${err.message}`);
    process.exit(1);
  }
  const unhandled = log.split(/\r?\n/).filter((l) => /Unhandled (Error|Rejection)/.test(l));
  if (unhandled.length > 0) {
    error(`Vitest log contains ${unhandled.length} unhandled error line(s):`);
    for (const l of unhandled.slice(0, 20)) console.error(l);
    process.exit(1);
  }
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (err) {
  error(`Cannot read vitest report "${reportPath}": ${err.message}`);
  process.exit(1);
}

if (!report || !(report.numTotalTests > 0)) {
  error('Vitest report has zero tests (numTotalTests is 0 or missing).');
  process.exit(1);
}

let known = new Set();
try {
  known = new Set(
    fs
      .readFileSync(knownPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
} catch (err) {
  error(`Cannot read known failures file "${knownPath}": ${err.message}`);
  process.exit(1);
}

const failed = new Set();
for (const file of report.testResults ?? []) {
  const rel = path.relative(process.cwd(), file.name).split(path.sep).join('/');
  const assertions = file.assertionResults ?? [];
  for (const a of assertions) {
    if (a.status === 'failed') failed.add(`${rel} > ${a.fullName}`);
  }
  if (file.status === 'failed' && assertions.length === 0) {
    failed.add(`${rel} > (suite failed to load)`);
  } else if (
    file.status === 'failed' &&
    !assertions.some((a) => a.status === 'failed')
  ) {
    failed.add(`${rel} > (suite error)`);
    if (file.message) console.error(`${rel}: ${file.message}`);
  }
}

const newFailures = [...failed].filter((f) => !known.has(f));
const nowPassing = [...known].filter((k) => !failed.has(k));

console.log(
  `Tests: total=${report.numTotalTests} passed=${report.numPassedTests} ` +
    `failed=${report.numFailedTests} skipped=${(report.numPendingTests ?? 0) + (report.numTodoTests ?? 0)}`,
);
console.log(`Known baseline failures still failing: ${failed.size - newFailures.length}`);

for (const k of nowPassing) {
  notice(`Known failure now passes; consider removing it from ${knownPath}: ${k}`);
}

if (newFailures.length > 0) {
  console.log(`\nNEW failures (${newFailures.length}):`);
  for (const f of newFailures) error(`New test failure: ${f}`);
  process.exit(1);
}

console.log('No new test failures.');
