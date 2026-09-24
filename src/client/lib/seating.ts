import type { PlayerView } from '../../shared/protocol.ts';

export interface Seating {
  top: PlayerView[];
  bottom: PlayerView[];
  left: PlayerView[];
  right: PlayerView[];
}

/**
 * Seats players around the table like in a real poker room: you sit in the middle of the
 * bottom row (next to your cards), everybody else fills the top row, the sides (on wide
 * screens, for bigger groups) and the rest of the bottom row, in the order they joined.
 */
export function arrangeSeats(players: PlayerView[], meId: string, allowSides: boolean): Seating {
  const me = players.find((p) => p.id === meId);
  const others = players.filter((p) => p.id !== meId);
  const total = players.length;
  const perSide = !allowSides ? 0 : total >= 14 ? 2 : total >= 7 ? 1 : 0;
  const rest = total - perSide * 2;
  const topCount = Math.floor(rest / 2);

  const queue = [...others];
  const top = queue.splice(0, topCount);
  const left = queue.splice(0, perSide);
  const right = queue.splice(0, perSide);
  const bottom = queue;
  if (me) bottom.splice(Math.floor(bottom.length / 2), 0, me);
  return { top, bottom, left, right };
}
