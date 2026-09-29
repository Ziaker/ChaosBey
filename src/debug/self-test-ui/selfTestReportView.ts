// ============================================================
// SELF TEST REPORT VIEW
// Text rendering of the GDD 163 batch report and the GDD 68 scenario
// results, and the downloadable JSON. Pure functions: tests assert on
// them and the page shows them.
// ============================================================

import type { AiBatchReport } from '../../self-test/AiBatchRunner';
import { KNOWN_ISSUES } from '../../self-test/anomalies/MatchAnomalyDetector';
import type { ScenarioResult } from '../../self-test/scenarios/ScenarioRunner';

export const SELF_TEST_REPORT_FORMAT = 'ChaosBeySelfTestReportV1';

export function renderBatchReport(report: AiBatchReport, finished: boolean): string {
  const lines = [
    `GDD 163 BATCH REPORT${finished ? '' : ' (in progress)'}`,
    `matches            ${report.matches}`,
    `pass / fail        ${report.passed} / ${report.failed}`,
    `crashes            ${report.crashes}`,
    `hangs              ${report.hangs}`,
    `invalid states     ${report.invalidStates} (unknown: ${report.unknownInvalidStates})`,
    `average duration   ${report.averageDurationS.toFixed(2)} s`,
    `ring-outs / KOs    ${report.outcomes.ringOuts} / ${report.outcomes.kos} (draws ${report.outcomes.draws}, unresolved ${report.outcomes.unresolved})`,
    `Clash count        ${report.clashCount}`,
    report.divergence.status === 'checked'
      ? `divergence         ${report.divergence.count} of ${report.divergence.checked} replays${report.divergence.diverged.map((d) => `; ${d.seed}: ${d.detail}`).join('')}`
      : `divergence         NOT CHECKED — ${report.divergence.reason}`,
    `performance        ${report.performanceAnomalies.length} match(es) with ticks over ${report.timing.slowTickThresholdMs.toFixed(1)} ms`,
    `acceleration       ${report.timing.simulatedS.toFixed(1)} s simulated in ${(report.timing.wallMs / 1000).toFixed(2)} s busy = ${report.timing.simulatedPerWallSecond.toFixed(1)}× real time`,
  ];
  const kinds = Object.entries(report.anomalyKinds);
  if (kinds.length > 0) lines.push(`anomaly kinds      ${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  const known = Object.entries(report.knownIssues);
  for (const [id, n] of known) lines.push(`known issue ${id}   ${n} detection(s) — ${KNOWN_ISSUES[id as keyof typeof KNOWN_ISSUES] ?? ''}`);
  if (report.warnings.length > 0) lines.push(`warnings           ${report.warnings.length} match(es): ${report.warnings.map((w) => `${w.seed} (${w.detections.map((d) => d.kind).join(', ')})`).join('; ')}`);
  lines.push(`seeds              ${report.seeds.length} (failing seeds listed below, each replayable)`);
  return lines.join('\n');
}

export function renderScenarioResults(results: readonly ScenarioResult[]): string {
  if (results.length === 0) return '';
  const header = 'GDD 68 SCENARIO PRESETS';
  const rows = results.map((r) => `${r.status.toUpperCase().padEnd(11)} ${r.label.padEnd(30)} t${String(r.ticks).padEnd(5)} ${r.detail}`);
  return [header, ...rows].join('\n');
}

export function selfTestReportJson(batch: AiBatchReport | null, scenarios: readonly ScenarioResult[]): string {
  return JSON.stringify(
    {
      format: SELF_TEST_REPORT_FORMAT,
      generatedAtIso: new Date().toISOString(),
      build: { version: __APP_BUILD_VERSION__, commit: __APP_COMMIT_HASH__ },
      batch,
      scenarios,
      knownIssues: KNOWN_ISSUES,
    },
    null,
    2,
  );
}
