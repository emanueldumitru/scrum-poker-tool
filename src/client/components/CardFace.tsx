import { COFFEE } from '../../shared/decks.ts';
import { Coffee } from './Icons.tsx';

/** Renders a card value; the coffee card gets an icon, long values a smaller font. */
export function CardFace({ value, iconSize = 18 }: { value: string | null; iconSize?: number }) {
  if (value === null) return null;
  if (value === COFFEE) {
    return (
      <span className="card-value" aria-label="Coffee break">
        <Coffee size={iconSize} strokeWidth={2.2} />
      </span>
    );
  }
  const length = Array.from(value).length;
  return <span className={`card-value${length >= 4 ? ' is-long' : length === 3 ? ' is-mid' : ''}`}>{value}</span>;
}

export function cardLabel(value: string): string {
  if (value === COFFEE) return 'coffee break';
  if (value === '?') return 'unsure';
  return value;
}
