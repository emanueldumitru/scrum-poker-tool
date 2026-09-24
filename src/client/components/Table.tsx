import { type CSSProperties, type ReactNode, useMemo } from 'react';
import type { GameState, PlayerView } from '../../shared/protocol.ts';
import { useMediaQuery } from '../lib/hooks.ts';
import { arrangeSeats } from '../lib/seating.ts';
import { Seat } from './Seat.tsx';

const SEAT_WIDTH = 100;

interface TableProps {
  state: GameState;
  onSeatOpen: (player: PlayerView, anchor: HTMLElement) => void;
  children: ReactNode;
}

export function Table({ state, onSeatOpen, children }: TableProps) {
  const wide = useMediaQuery('(min-width: 900px)');
  const seating = useMemo(() => arrangeSeats(state.players, state.you.id, wide), [state.players, state.you.id, wide]);
  const phase = state.round.phase;

  // Flip order: left to right along the top, down the right side, back along the bottom.
  const order = new Map<string, number>();
  [...seating.left, ...seating.top, ...seating.right, ...[...seating.bottom].reverse()].forEach((p, i) => order.set(p.id, i));

  const columns = Math.max(seating.top.length, seating.bottom.length, 3);
  const style = {
    '--table-width': `${columns * SEAT_WIDTH + 16}px`,
    '--side-rows': Math.max(1, seating.left.length),
  } as CSSProperties;

  const row = (players: PlayerView[], className: string) => (
    <div className={`seats ${className}`}>
      {players.map((player) => (
        <Seat
          key={player.id}
          player={player}
          isMe={player.id === state.you.id}
          phase={phase}
          order={order.get(player.id) ?? 0}
          onOpen={onSeatOpen}
        />
      ))}
    </div>
  );

  return (
    <div className={`table-area phase-${phase}`} style={style}>
      {row(seating.top, 'seats-top')}
      {row(seating.left, 'seats-left')}
      <div className="table">{children}</div>
      {row(seating.right, 'seats-right')}
      {row(seating.bottom, 'seats-bottom')}
    </div>
  );
}
