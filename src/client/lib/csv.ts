import type { HistoryEntry, IssueView } from '../../shared/protocol.ts';

/** Quotes a CSV cell and neutralizes spreadsheet formulas (CSV injection). */
function cell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  // BOM so Excel opens UTF-8 (diacritics in Romanian/Hungarian/Bulgarian names) correctly.
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function issuesCsv(issues: IssueView[]): Array<Array<string | null>> {
  return [['Title', 'Link', 'Estimate'], ...issues.map((i) => [i.title, i.link, i.estimate])];
}

export function historyCsv(entries: HistoryEntry[]): Array<Array<string | number | null>> {
  return [
    ['Round', 'Issue', 'Revealed at', 'Result', 'Average', 'Agreement', 'Votes'],
    ...entries.map((e, index) => [
      index + 1,
      e.issueTitle,
      new Date(e.revealedAt).toISOString(),
      e.result,
      e.stats.average,
      e.stats.agreement === null ? null : `${Math.round(e.stats.agreement * 100)}%`,
      e.votes.map((v) => `${v.name}: ${v.value}`).join('; '),
    ]),
  ];
}

export function safeFilename(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'game';
}
