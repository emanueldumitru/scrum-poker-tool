import { useId } from 'react';
import { type DeckId, type DeckInput, PRESET_DECKS, isPresetDeckId, resolveDeck, splitCardList } from '../../shared/decks.ts';
import { CardFace } from './CardFace.tsx';
import { ChevronDown } from './Icons.tsx';

export interface DeckChoice {
  id: DeckId;
  custom: string;
}

export const DEFAULT_CUSTOM_CARDS = '1, 2, 3, 5, 8, 13, ?, ☕';

export function deckInputFor(choice: DeckChoice): DeckInput {
  return isPresetDeckId(choice.id) ? { id: choice.id } : { id: 'custom', cards: splitCardList(choice.custom) };
}

/** Voting-system selector with a live preview of the cards; validates custom decks. */
export function DeckPicker({ value, onChange }: { value: DeckChoice; onChange: (value: DeckChoice) => void }) {
  const id = useId();
  const resolved = resolveDeck(deckInputFor(value));
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Voting system
      </label>
      <div className="select-wrap">
        <select id={id} className="select" value={value.id} onChange={(event) => onChange({ ...value, id: event.target.value as DeckId })}>
          {PRESET_DECKS.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.name} ( {deck.cards.join(', ')} )
            </option>
          ))}
          <option value="custom">Create custom deck…</option>
        </select>
        <ChevronDown className="select-chevron" size={18} />
      </div>
      {value.id === 'custom' && (
        <>
          <input
            className="input"
            value={value.custom}
            onChange={(event) => onChange({ ...value, custom: event.target.value })}
            placeholder="Comma-separated values, e.g. 1, 2, 3, 5, 8, ?, ☕"
            aria-label="Custom card values"
            aria-invalid={!resolved.ok}
          />
          <p className={resolved.ok ? 'field-hint' : 'form-error'}>
            {resolved.ok ? 'Up to 5 characters per card. Include ? and ☕ if you want them.' : resolved.message}
          </p>
        </>
      )}
      {resolved.ok && (
        <div className="deck-preview" aria-hidden="true">
          {resolved.deck.cards.map((card) => (
            <span key={card} className="mini-card is-static">
              <CardFace value={card} iconSize={13} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
