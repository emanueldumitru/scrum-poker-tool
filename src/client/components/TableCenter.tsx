import { COFFEE } from '../../shared/decks.ts';
import type { GameState } from '../../shared/protocol.ts';
import type { GameConnection } from '../lib/connection.ts';
import { useNow } from '../lib/hooks.ts';
import { CardFace } from './CardFace.tsx';
import { Pencil, UserPlus } from './Icons.tsx';
import { Popover, usePopover } from './ui/Popover.tsx';

interface Props {
  state: GameState;
  conn: GameConnection;
  offset: number;
  onInvite: () => void;
}

export function TableCenter({ state, conn, offset, onInvite }: Props) {
  const { round, you } = state;
  if (round.phase === 'revealing') return <Countdown revealAt={round.revealAt ?? 0} offset={offset} />;
  if (round.phase === 'revealed') return <RoundResult state={state} conn={conn} />;

  const anyVotes = state.players.some((p) => p.voted && !p.spectator);
  if (!anyVotes && state.players.length === 1) {
    return (
      <div className="table-lonely">
        <p className="table-hint">
          Feeling lonely? <span aria-hidden="true">🥱</span>
        </p>
        <button type="button" className="btn btn-outline btn-sm" onClick={onInvite}>
          <UserPlus size={16} /> Invite players
        </button>
      </div>
    );
  }
  if (!anyVotes) return <p className="table-hint">Pick your cards!</p>;

  const voters = state.players.filter((p) => !p.spectator);
  const progress = (
    <span className="table-progress">
      {voters.filter((p) => p.voted).length} of {voters.length} voted
    </span>
  );
  if (!you.can.reveal) {
    return (
      <div className="table-stack">
        <p className="table-hint">Waiting for the facilitator to reveal…</p>
        {progress}
      </div>
    );
  }
  return (
    <div className="table-stack">
      <button type="button" className="btn btn-primary btn-reveal" onClick={() => conn.send({ type: 'reveal' })}>
        Reveal cards
      </button>
      {progress}
    </div>
  );
}

function Countdown({ revealAt, offset }: { revealAt: number; offset: number }) {
  const now = useNow(true, 100);
  const remaining = Math.max(0, revealAt - (now + offset));
  const seconds = Math.min(3, Math.max(1, Math.ceil(remaining / 1000)));
  return (
    <span key={seconds} className="countdown" role="timer" aria-live="assertive">
      {seconds}
    </span>
  );
}

function RoundResult({ state, conn }: { state: GameState; conn: GameConnection }) {
  const { round, you, game } = state;
  const stats = round.stats;
  const picker = usePopover();
  let caption = 'Result';
  if (round.resultOverridden) caption = 'Final estimate';
  else if (stats?.consensus && stats.voteCount > 1) caption = 'Consensus';
  else if (round.result === null) caption = 'No estimate';
  else if (stats && stats.distribution.length > 1) caption = 'Suggested';

  const choose = (value: string | null) => {
    conn.send({ type: 'setResult', value });
    picker.close();
  };

  return (
    <div className="round-result">
      <span className="round-result-caption">{caption}</span>
      <span className="round-result-value">{round.result === null ? '–' : <CardFace value={round.result} iconSize={30} />}</span>
      {you.can.reveal && (
        <button
          type="button"
          className="round-result-edit"
          aria-label="Change the final estimate"
          title="Change the final estimate"
          onClick={picker.toggle}
        >
          <Pencil size={14} />
        </button>
      )}
      <Popover anchor={picker.anchor} open={picker.open} onClose={picker.close} placement="bottom" label="Final estimate">
        <div className="picker">
          <p className="picker-title">Set the final estimate</p>
          <div className="mini-deck">
            {game.deck.cards
              .filter((card) => card !== COFFEE)
              .map((card) => (
                <button
                  key={card}
                  type="button"
                  className={`mini-card${card === round.result ? ' is-selected' : ''}`}
                  onClick={() => choose(card)}
                >
                  <CardFace value={card} iconSize={14} />
                </button>
              ))}
          </div>
          {round.resultOverridden && stats?.suggested && (
            <button type="button" className="btn btn-ghost btn-sm picker-reset" onClick={() => choose(null)}>
              Back to suggested ({stats.suggested})
            </button>
          )}
        </div>
      </Popover>
    </div>
  );
}
