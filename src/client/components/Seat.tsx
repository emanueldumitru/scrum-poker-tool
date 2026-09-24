import { type CSSProperties, memo } from 'react';
import type { Phase, PlayerView } from '../../shared/protocol.ts';
import { CardFace, cardLabel } from './CardFace.tsx';
import { Crown, Eye } from './Icons.tsx';

interface SeatProps {
  player: PlayerView;
  isMe: boolean;
  phase: Phase;
  /** Position in the flip cascade. */
  order: number;
  onOpen: (player: PlayerView, anchor: HTMLElement) => void;
}

function describe(player: PlayerView, phase: Phase, isMe: boolean): string {
  const who = isMe ? `${player.name} (you)` : player.name;
  if (player.spectator) return `${who}, spectator`;
  if (phase === 'revealed') return player.vote ? `${who} voted ${cardLabel(player.vote)}` : `${who} did not vote`;
  return player.voted ? `${who} has voted` : `${who} has not voted yet`;
}

export const Seat = memo(function Seat({ player, isMe, phase, order, onOpen }: SeatProps) {
  const revealed = phase === 'revealed';
  let cardState: string;
  if (player.spectator) cardState = 'is-spectator';
  else if (revealed) cardState = player.vote ? 'is-flipped' : 'is-empty';
  else cardState = player.voted ? 'is-down' : 'is-empty';

  return (
    <div className={`seat${player.online ? '' : ' is-offline'}${isMe ? ' is-me' : ''}`} data-seat={player.id}>
      <button
        type="button"
        className={`seat-card ${cardState}`}
        style={{ '--flip-delay': `${order * 70}ms` } as CSSProperties}
        aria-label={describe(player, phase, isMe)}
        title={player.online ? undefined : `${player.name} is reconnecting…`}
        onClick={(event) => onOpen(player, event.currentTarget)}
      >
        {player.spectator ? (
          <Eye size={18} />
        ) : (
          <span className="seat-card-inner">
            <span className="seat-card-face seat-card-back" />
            <span className="seat-card-face seat-card-front">
              <CardFace value={revealed ? player.vote : null} iconSize={16} />
            </span>
          </span>
        )}
      </button>
      <span className="seat-name">
        {player.facilitator && (
          <span className="seat-badge" title="Facilitator">
            <Crown size={12} />
          </span>
        )}
        <span className="seat-name-text" title={player.name}>
          {player.name}
        </span>
      </span>
    </div>
  );
});
