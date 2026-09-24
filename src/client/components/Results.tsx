import { type CSSProperties, useEffect, useState } from 'react';
import type { GameState, IssueView } from '../../shared/protocol.ts';
import { formatNumber } from '../../shared/stats.ts';
import type { GameConnection } from '../lib/connection.ts';
import { CardFace, cardLabel } from './CardFace.tsx';
import { ArrowRight, Refresh } from './Icons.tsx';
import { MOOD_MESSAGES, Robot } from './Robot.tsx';
import { Tooltip } from './ui/Controls.tsx';

interface Props {
  state: GameState;
  conn: GameConnection;
  nextIssue: IssueView | null;
}

export function Results({ state, conn, nextIssue }: Props) {
  const { round, you, game } = state;
  const stats = round.stats;
  const [showMood, setShowMood] = useState(true);

  // Pop the robot's reaction for a few seconds after every reveal.
  useEffect(() => {
    setShowMood(true);
    const timer = window.setTimeout(() => setShowMood(false), 4500);
    return () => window.clearTimeout(timer);
  }, [round.number]);

  if (!stats) return null;
  const max = Math.max(1, ...stats.distribution.map((b) => b.count));
  const agreementPct = stats.agreement === null ? null : Math.round(stats.agreement * 100);

  return (
    <section className="results" aria-label="Voting results">
      <div className="results-stats">
        <div className="results-bars">
          {stats.distribution.map((bucket, index) => (
            <Tooltip key={bucket.value} content={bucket.voters.join(', ')}>
              <div
                className="bar"
                tabIndex={0}
                aria-label={`${bucket.count} ${bucket.count === 1 ? 'vote' : 'votes'} for ${cardLabel(bucket.value)}: ${bucket.voters.join(', ')}`}
              >
                <span className="bar-count">{bucket.count}</span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ height: `${(bucket.count / max) * 100}%`, '--bar-delay': `${index * 60}ms` } as CSSProperties}
                  />
                </span>
                <span className="bar-label">
                  <CardFace value={bucket.value} iconSize={15} />
                </span>
              </div>
            </Tooltip>
          ))}
        </div>

        <Tooltip
          open={showMood}
          align="start"
          content={
            <>
              {MOOD_MESSAGES[stats.mood]}
              {agreementPct !== null && stats.voteCount > 1 && <span className="tooltip-sub">{agreementPct}% agreement</span>}
            </>
          }
        >
          <div className="results-stat" tabIndex={0} onMouseEnter={() => setShowMood(false)}>
            <Robot mood={stats.mood} value={stats.agreement ?? 0} />
            <span className="results-stat-label">Agreement</span>
          </div>
        </Tooltip>

        {game.settings.showAverage && stats.average !== null && (
          <div className="results-stat">
            <span className="results-stat-value">{formatNumber(stats.average)}</span>
            <span className="results-stat-label">Average</span>
          </div>
        )}
      </div>

      <div className="results-divider" />

      <div className="results-actions">
        {you.can.reveal ? (
          <button type="button" className="btn btn-primary" onClick={() => conn.send({ type: 'reset' })}>
            <Refresh size={18} /> Vote again
          </button>
        ) : (
          <p className="muted">Waiting for the facilitator to start the next round…</p>
        )}
        {nextIssue && you.can.manageIssues && (
          <button type="button" className="btn btn-outline" onClick={() => conn.send({ type: 'issues:next' })} title={nextIssue.title}>
            Next issue <ArrowRight size={18} />
          </button>
        )}
      </div>
    </section>
  );
}
