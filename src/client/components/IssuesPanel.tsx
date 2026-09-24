import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { COFFEE, cardNumericValue } from '../../shared/decks.ts';
import { LIMITS } from '../../shared/limits.ts';
import type { GameState, IssueView } from '../../shared/protocol.ts';
import { formatNumber } from '../../shared/stats.ts';
import type { GameConnection } from '../lib/connection.ts';
import { downloadCsv, issuesCsv, safeFilename } from '../lib/csv.ts';
import { type IssueDraft, parseIssueLines, validateIssue } from '../lib/issues.ts';
import { toast } from '../lib/toast.ts';
import { CardFace } from './CardFace.tsx';
import { ArrowDown, ArrowUp, Close, Download, ExternalLink, More, Pencil, Plus, Trash } from './Icons.tsx';
import { Confirm } from './ui/Confirm.tsx';
import { MenuItem, MenuSeparator } from './ui/Menu.tsx';
import { Popover, usePopover } from './ui/Popover.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  state: GameState;
  issues: IssueView[];
  conn: GameConnection;
}

type Draft = IssueDraft;

function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}

export function IssuesPanel({ open, onClose, state, issues, conn }: Props) {
  const can = state.you.can.manageIssues;
  const [adding, setAdding] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const menu = usePopover();
  const points = issues.reduce((sum, issue) => sum + (issue.estimate ? (cardNumericValue(issue.estimate) ?? 0) : 0), 0);
  const estimated = issues.filter((i) => i.estimate !== null).length;

  const addIssues = (drafts: Draft[]) => {
    if (drafts.length === 0) return false;
    if (drafts.length > LIMITS.issuesPerMessage) {
      toast(`Add at most ${LIMITS.issuesPerMessage} issues at a time.`, 'error');
      return false;
    }
    if (!conn.send({ type: 'issues:add', issues: drafts })) return false;
    if (drafts.length > 1) toast(`Added ${drafts.length} issues`, 'success');
    return true;
  };

  return (
    <aside className={`issues-panel${open ? ' is-open' : ''}`} aria-label="Issues" aria-hidden={!open} inert={!open}>
      <header className="issues-header">
        <div>
          <h2>Issues</h2>
          <p className="muted small">
            {issues.length === 0
              ? 'No issues yet'
              : `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} · ${estimated} estimated${points ? ` · ${formatNumber(points)} points` : ''}`}
          </p>
        </div>
        <div className="issues-header-actions">
          <button type="button" className="icon-btn" onClick={menu.toggle} aria-label="Issue actions" disabled={issues.length === 0 && !can}>
            <More />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close issues">
            <Close />
          </button>
        </div>
        <Popover anchor={menu.anchor} open={menu.open} onClose={menu.close} placement="bottom-end" label="Issue actions">
          <div className="menu" role="menu">
            <MenuItem
              icon={<Download size={18} />}
              disabled={issues.length === 0}
              onClick={() => {
                menu.close();
                downloadCsv(`${safeFilename(state.game.name)}-issues.csv`, issuesCsv(issues));
              }}
            >
              Export to CSV
            </MenuItem>
            {can && (
              <>
                <MenuItem
                  icon={<Plus size={18} />}
                  onClick={() => {
                    menu.close();
                    setAdding(true);
                  }}
                >
                  Add or paste issues
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={<Trash size={18} />}
                  danger
                  disabled={issues.length === 0}
                  onClick={() => {
                    menu.close();
                    setConfirmClear(true);
                  }}
                >
                  Delete all issues
                </MenuItem>
              </>
            )}
          </div>
        </Popover>
      </header>

      <div className="issues-body">
        {issues.length === 0 && !adding && (
          <div className="issues-empty">
            <p>Add the stories you want to estimate, then vote on them one by one.</p>
            <p className="muted small">Tip: paste several lines at once — links in a line are kept as the issue link.</p>
          </div>
        )}
        <ol className="issues-list">
          {issues.map((issue, index) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              index={index}
              total={issues.length}
              active={state.activeIssueId === issue.id}
              can={can}
              deck={state.game.deck.cards}
              conn={conn}
            />
          ))}
        </ol>
        {can &&
          (adding ? (
            <IssueForm
              submitLabel="Add"
              allowBulk
              onCancel={() => setAdding(false)}
              onSubmit={(drafts) => {
                if (addIssues(drafts)) setAdding(false);
              }}
            />
          ) : (
            <button type="button" className="issues-add" onClick={() => setAdding(true)}>
              <Plus size={18} /> Add an issue
            </button>
          ))}
      </div>

      <Confirm
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Delete all issues?"
        message="This removes every issue and its estimate for everyone in the game."
        confirmLabel="Delete all"
        danger
        onConfirm={() => conn.send({ type: 'issues:clear' })}
      />
    </aside>
  );
}

interface CardProps {
  issue: IssueView;
  index: number;
  total: number;
  active: boolean;
  can: boolean;
  deck: string[];
  conn: GameConnection;
}

function IssueCard({ issue, index, total, active, can, deck, conn }: CardProps) {
  const [editing, setEditing] = useState(false);
  const menu = usePopover();
  const estimate = usePopover();

  if (editing) {
    return (
      <li className="issue is-editing">
        <IssueForm
          submitLabel="Save"
          initial={issue}
          onCancel={() => setEditing(false)}
          onSubmit={([draft]) => {
            if (draft && conn.send({ type: 'issues:update', id: issue.id, title: draft.title, link: draft.link })) setEditing(false);
          }}
        />
      </li>
    );
  }

  const act = (fn: () => void) => () => {
    menu.close();
    fn();
  };

  return (
    <li className={`issue${active ? ' is-active' : ''}`}>
      <div className="issue-top">
        <p className="issue-title">{issue.title}</p>
        {can && (
          <button type="button" className="icon-btn icon-btn-sm" onClick={menu.toggle} aria-label={`Actions for ${issue.title}`}>
            <More size={18} />
          </button>
        )}
      </div>
      <div className="issue-bottom">
        {issue.link ? (
          <a className="issue-link" href={issue.link} target="_blank" rel="noopener noreferrer" title={issue.link}>
            <ExternalLink size={14} />
            <span>{hostOf(issue.link)}</span>
          </a>
        ) : (
          <span />
        )}
        <div className="issue-actions">
          {active ? (
            <span className="issue-status">Voting now…</span>
          ) : (
            can && (
              <button type="button" className="btn btn-soft btn-sm" onClick={() => conn.send({ type: 'issues:vote', id: issue.id })}>
                {issue.estimate ? 'Re-vote' : 'Vote this issue'}
              </button>
            )
          )}
          <button
            type="button"
            className={`issue-estimate${issue.estimate ? '' : ' is-empty'}`}
            onClick={estimate.toggle}
            disabled={!can}
            aria-label={issue.estimate ? `Estimate ${issue.estimate}, change` : 'Set estimate'}
            title={can ? 'Set estimate' : undefined}
          >
            {issue.estimate ? <CardFace value={issue.estimate} iconSize={14} /> : '–'}
          </button>
        </div>
      </div>

      <Popover anchor={menu.anchor} open={menu.open} onClose={menu.close} placement="bottom-end" label="Issue actions">
        <div className="menu" role="menu">
          <MenuItem icon={<Pencil size={18} />} onClick={act(() => setEditing(true))}>
            Edit
          </MenuItem>
          {active && (
            <MenuItem icon={<Close size={18} />} onClick={act(() => conn.send({ type: 'issues:vote', id: null }))}>
              Stop voting on this issue
            </MenuItem>
          )}
          <MenuItem icon={<ArrowUp size={18} />} disabled={index === 0} onClick={act(() => conn.send({ type: 'issues:move', id: issue.id, toIndex: index - 1 }))}>
            Move up
          </MenuItem>
          <MenuItem
            icon={<ArrowDown size={18} />}
            disabled={index === total - 1}
            onClick={act(() => conn.send({ type: 'issues:move', id: issue.id, toIndex: index + 1 }))}
          >
            Move down
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash size={18} />} danger onClick={act(() => conn.send({ type: 'issues:delete', id: issue.id }))}>
            Delete
          </MenuItem>
        </div>
      </Popover>

      <Popover anchor={estimate.anchor} open={estimate.open} onClose={estimate.close} placement="bottom-end" label="Estimate">
        <div className="picker">
          <p className="picker-title">Estimate</p>
          <div className="mini-deck">
            {deck
              .filter((card) => card !== COFFEE)
              .map((card) => (
                <button
                  key={card}
                  type="button"
                  className={`mini-card${card === issue.estimate ? ' is-selected' : ''}`}
                  onClick={() => {
                    conn.send({ type: 'issues:update', id: issue.id, estimate: card });
                    estimate.close();
                  }}
                >
                  <CardFace value={card} iconSize={14} />
                </button>
              ))}
          </div>
          {issue.estimate && (
            <button
              type="button"
              className="btn btn-ghost btn-sm picker-reset"
              onClick={() => {
                conn.send({ type: 'issues:update', id: issue.id, estimate: null });
                estimate.close();
              }}
            >
              Clear estimate
            </button>
          )}
        </div>
      </Popover>
    </li>
  );
}

interface FormProps {
  initial?: IssueView;
  submitLabel: string;
  allowBulk?: boolean;
  onSubmit: (drafts: Draft[]) => void;
  onCancel: () => void;
}

function IssueForm({ initial, submitLabel, allowBulk, onSubmit, onCancel }: FormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [link, setLink] = useState(initial?.link ?? '');
  const [error, setError] = useState<string | null>(null);
  const drafts = allowBulk ? parseIssueLines(title) : [];
  const bulk = allowBulk && drafts.length > 1;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (bulk) {
      onSubmit(drafts);
      return;
    }
    const result = validateIssue(title, link);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    onSubmit([result]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !bulk) {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="issue-form" onSubmit={submit}>
      <textarea
        className="textarea"
        value={title}
        autoFocus
        rows={bulk ? Math.min(8, drafts.length + 1) : 2}
        placeholder={allowBulk ? 'Issue title — or paste several lines' : 'Issue title'}
        aria-label="Issue title"
        onChange={(event) => {
          setTitle(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
      />
      {!bulk && (
        <input
          className="input input-sm"
          value={link}
          placeholder="Link (optional), e.g. https://jira…/browse/ABC-123"
          aria-label="Issue link"
          inputMode="url"
          onChange={(event) => {
            setLink(event.target.value);
            setError(null);
          }}
        />
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="issue-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim()}>
          {bulk ? `Add ${drafts.length} issues` : submitLabel}
        </button>
      </div>
    </form>
  );
}
