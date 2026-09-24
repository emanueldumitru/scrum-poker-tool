import { Fragment, useEffect, useState } from 'react';
import type { GameState, HistoryEntry } from '../../../shared/protocol.ts';
import { formatNumber } from '../../../shared/stats.ts';
import type { GameConnection } from '../../lib/connection.ts';
import { downloadCsv, historyCsv, safeFilename } from '../../lib/csv.ts';
import { CardFace } from '../CardFace.tsx';
import { ChevronDown, Download, Trash } from '../Icons.tsx';
import { Confirm } from '../ui/Confirm.tsx';
import { Spinner } from '../ui/Controls.tsx';
import { Modal } from '../ui/Modal.tsx';

interface Props {
  onClose: () => void;
  state: GameState;
  conn: GameConnection;
  history: HistoryEntry[] | null;
}

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateTime = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function when(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toDateString() === new Date().toDateString() ? time.format(date) : dateTime.format(date);
}

/** Mounted only while open; subscribes to history updates for as long as it is visible. */
export function HistoryDialog({ onClose, state, conn, history }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    conn.watchHistory(true);
    return () => conn.watchHistory(false);
  }, [conn]);

  const entries = history ? [...history].reverse() : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Voting history"
      size="lg"
      footer={
        entries && entries.length > 0 ? (
          <>
            {state.you.can.manageGame && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>
                <Trash size={16} /> Clear history
              </button>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => downloadCsv(`${safeFilename(state.game.name)}-history.csv`, historyCsv(history ?? []))}
            >
              <Download size={16} /> Export CSV
            </button>
          </>
        ) : undefined
      }
    >
      {entries === null ? (
        <div className="center-block">
          <Spinner size={22} />
        </div>
      ) : entries.length === 0 ? (
        <p className="muted">No rounds yet. Every time the cards are revealed, the round is recorded here.</p>
      ) : (
        <div className="history-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col">Issue</th>
                <th scope="col">Result</th>
                <th scope="col">Average</th>
                <th scope="col">Agreement</th>
                <th scope="col">Time</th>
                <th scope="col">
                  <span className="sr-only">Votes</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const open = expanded === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <tr className={open ? 'is-open' : ''}>
                      <td className="num">#{entries.length - index}</td>
                      <td className="history-issue">{entry.issueTitle ?? <span className="muted">—</span>}</td>
                      <td>
                        <span className="result-pill">{entry.result === null ? '–' : <CardFace value={entry.result} iconSize={13} />}</span>
                      </td>
                      <td className="num">{entry.stats.average === null ? '–' : formatNumber(entry.stats.average)}</td>
                      <td className="num">{entry.stats.agreement === null ? '–' : `${Math.round(entry.stats.agreement * 100)}%`}</td>
                      <td className="muted nowrap">{when(entry.revealedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm history-toggle"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : entry.id)}
                        >
                          {entry.votes.length} {entry.votes.length === 1 ? 'vote' : 'votes'}
                          <ChevronDown size={14} />
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="history-votes">
                        <td colSpan={7}>
                          {entry.votes.map((vote, index) => (
                            <span key={index} className="vote-chip">
                              {vote.name} <b>{vote.value}</b>
                            </span>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Confirm
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear voting history?"
        message="All recorded rounds are deleted for everyone. Issue estimates are kept."
        confirmLabel="Clear history"
        danger
        onConfirm={() => conn.send({ type: 'history:clear' })}
      />
    </Modal>
  );
}
