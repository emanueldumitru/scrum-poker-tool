import { useEffect } from 'react';
import { COFFEE } from '../../shared/decks.ts';
import type { GameState } from '../../shared/protocol.ts';
import type { GameConnection } from '../lib/connection.ts';
import { isTyping, useLatest } from '../lib/hooks.ts';
import { CardFace, cardLabel } from './CardFace.tsx';
import { Eye } from './Icons.tsx';

interface Props {
  state: GameState;
  conn: GameConnection;
}

export function Deck({ state, conn }: Props) {
  const me = state.players.find((p) => p.id === state.you.id);
  const cards = state.game.deck.cards;
  const selected = me?.vote ?? null;
  useCardShortcuts(cards, (value) => conn.vote(value), !me?.spectator);

  if (me?.spectator) {
    return (
      <div className="deck deck-spectator">
        <p>
          <Eye size={18} /> You are watching as a spectator.
        </p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => conn.updateProfile({ spectator: false })}>
          Join as a player
        </button>
      </div>
    );
  }

  return (
    <div className="deck">
      <p className="deck-hint">
        Choose your card <span aria-hidden="true">👇</span>
      </p>
      <div className="deck-cards" role="group" aria-label="Your card">
        {cards.map((card) => (
          <button
            key={card}
            type="button"
            className={`deck-card${card === selected ? ' is-selected' : ''}`}
            aria-pressed={card === selected}
            aria-label={`Vote ${cardLabel(card)}`}
            onClick={() => conn.vote(card === selected ? null : card)}
          >
            <CardFace value={card} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Type a card's value to vote: "5", "13", "xl", "?" — "c" picks the coffee card and
 * Backspace withdraws the vote. Ambiguous prefixes ("1" vs "13") wait briefly for more keys.
 */
function useCardShortcuts(cards: string[], pick: (value: string | null) => void, enabled: boolean) {
  const pickRef = useLatest(pick);
  const cardsKey = cards.join('\u0000');
  useEffect(() => {
    if (!enabled) return;
    const deck = cardsKey.split('\u0000');
    const lower = deck.map((card) => card.toLowerCase());
    let buffer = '';
    let timer: number | undefined;
    const commit = (value: string | null) => {
      buffer = '';
      pickRef.current(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) return;
      if (document.body.classList.contains('has-modal') || document.querySelector('.popover')) return;
      window.clearTimeout(timer);
      if (event.key === 'Backspace' || event.key === 'Delete') {
        commit(null);
        return;
      }
      if (event.key.length !== 1) return;
      let candidate = (buffer + event.key).toLowerCase();
      if (!lower.some((card) => card.startsWith(candidate))) candidate = event.key.toLowerCase();
      const matches = lower.filter((card) => card.startsWith(candidate));
      if (matches.length === 0) {
        buffer = '';
        if (candidate === 'c' && deck.includes(COFFEE)) commit(COFFEE);
        return;
      }
      buffer = candidate;
      const exact = lower.indexOf(candidate);
      if (exact >= 0 && matches.length === 1) {
        commit(deck[exact]!);
        return;
      }
      timer = window.setTimeout(() => {
        if (exact >= 0) commit(deck[exact]!);
        buffer = '';
      }, 600);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [cardsKey, enabled, pickRef]);
}
