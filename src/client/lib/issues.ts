import { LIMITS, cleanText, cleanUrl, truncateText } from '../../shared/limits.ts';

export interface IssueDraft {
  title: string;
  link: string | null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;

/**
 * One issue per line; a URL anywhere in the line becomes the issue's link. Handles text pasted
 * from Jira/Linear lists and spreadsheet rows (tab-separated columns are joined with spaces).
 * Uses the same rules as the server, so a paste is never partially rejected: over-long titles
 * are shortened and unusable links are dropped.
 */
export function parseIssueLines(text: string): IssueDraft[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const url = URL_IN_TEXT.exec(line)?.[0] ?? null;
      const link = url ? cleanUrl(url) : null;
      const rest = (link && url ? line.replace(url, ' ') : line).replace(/[\t|]+/g, ' ');
      const title = truncateText(rest, LIMITS.issueTitle) || (link ? truncateText(link, LIMITS.issueTitle) : '');
      return { title, link };
    })
    .filter((draft) => draft.title);
}

/** Validates a single issue typed into the form; returns an error message or the clean draft. */
export function validateIssue(title: string, link: string): IssueDraft | string {
  if (!title.trim()) return 'Give the issue a title.';
  const cleanTitle = cleanText(title, LIMITS.issueTitle);
  if (!cleanTitle) return `Keep the title under ${LIMITS.issueTitle} characters.`;
  if (!link.trim()) return { title: cleanTitle, link: null };
  const cleanLink = cleanUrl(link);
  if (!cleanLink) return 'That link is not a valid http(s) address.';
  return { title: cleanTitle, link: cleanLink };
}
