import { type FormEvent, useState } from 'react';
import { LIMITS, cleanText } from '../../shared/limits.ts';
import { DEFAULT_SETTINGS, type GameSettings, ROOM_ID_PATTERN } from '../../shared/protocol.ts';
import { resolveDeck } from '../../shared/decks.ts';
import { DEFAULT_CUSTOM_CARDS, type DeckChoice, DeckPicker, deckInputFor } from '../components/DeckPicker.tsx';
import { ArrowRight, ChevronDown, Close } from '../components/Icons.tsx';
import { Logo } from '../components/Logo.tsx';
import { SettingsFields } from '../components/SettingsFields.tsx';
import { createGame } from '../lib/api.ts';
import { navigate } from '../lib/router.ts';
import { type RecentGame, forgetGame, getRecentGames, getSecret, rememberGame } from '../lib/storage.ts';

const DEFAULT_NAME = 'Planning poker';

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(timestamp: number): string {
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}

/** Accepts a full game link or just the 20-character code. */
function extractGameId(input: string): string | null {
  const match = /([A-Za-z0-9]{20})\/?\s*$/.exec(input.trim());
  return match && ROOM_ID_PATTERN.test(match[1]!) ? match[1]! : null;
}

export function HomePage() {
  const [name, setName] = useState('');
  const [deck, setDeck] = useState<DeckChoice>({ id: 'fibonacci', custom: DEFAULT_CUSTOM_CARDS });
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentGame[]>(getRecentGames);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const deckOk = resolveDeck(deckInputFor(deck)).ok;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const gameName = cleanText(name || DEFAULT_NAME, LIMITS.gameName);
    if (!gameName) return setError(`Keep the name under ${LIMITS.gameName} characters.`);
    setBusy(true);
    setError(null);
    try {
      const { id } = await createGame({ name: gameName, deck: deckInputFor(deck), settings, secret: getSecret() });
      rememberGame({ id, name: gameName });
      navigate(`/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    const id = extractGameId(joinCode);
    if (!id) return setJoinError('Paste the full game link you received.');
    navigate(`/${id}`);
  };

  return (
    <div className="home">
      <header className="home-header">
        <Logo size={34} />
        <span className="brand">Scrum Poker</span>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1>
            Estimate together,
            <br />
            <span className="accent">in seconds.</span>
          </h1>
          <p className="home-lead">
            Create a game, share the link, pick your cards. Real-time planning poker for your team — no sign-up, nothing to install.
          </p>
          <ul className="home-points">
            <li>Hidden votes until everyone is ready, then a synchronized reveal</li>
            <li>Average, agreement and vote spread for every round</li>
            <li>Issues list, voting history, timer and CSV export</li>
          </ul>
          <div className="hero-cards" aria-hidden="true">
            {['1', '3', '5', '8', '13'].map((value, index) => (
              <span key={value} className={`hero-card hero-card-${index}${value === '5' ? ' is-selected' : ''}`}>
                {value}
              </span>
            ))}
          </div>
        </section>

        <section className="home-panel">
          <form className="home-card" onSubmit={create}>
            <h2>Create a game</h2>
            <div className="field">
              <label className="field-label" htmlFor="game-name">
                Game's name
              </label>
              <input
                id="game-name"
                className="input"
                value={name}
                maxLength={LIMITS.gameName}
                placeholder={`e.g. Sprint 42 · ${DEFAULT_NAME}`}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <DeckPicker value={deck} onChange={setDeck} />
            <button type="button" className="link-btn" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
              {advanced ? 'Hide advanced settings' : 'Show advanced settings'}
              <ChevronDown size={16} className={advanced ? 'rotate-180' : ''} />
            </button>
            {advanced && <SettingsFields value={settings} onChange={setSettings} />}
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !deckOk}>
              {busy ? 'Creating…' : 'Create game'}
            </button>
          </form>

          <form className="home-join" onSubmit={join}>
            <label className="field-label" htmlFor="join-code">
              Got an invitation link?
            </label>
            <div className="input-row">
              <input
                id="join-code"
                className="input"
                value={joinCode}
                placeholder="Paste the game link"
                onChange={(event) => {
                  setJoinCode(event.target.value);
                  setJoinError(null);
                }}
              />
              <button type="submit" className="btn btn-outline" disabled={!joinCode.trim()}>
                Join <ArrowRight size={16} />
              </button>
            </div>
            {joinError && <p className="form-error">{joinError}</p>}
          </form>

          {recent.length > 0 && (
            <div className="home-recent">
              <h3>Your recent games</h3>
              <ul>
                {recent.map((game) => (
                  <li key={game.id}>
                    <a
                      href={`/${game.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/${game.id}`);
                      }}
                    >
                      <span className="recent-name">{game.name}</span>
                      <span className="recent-time">{ago(game.visitedAt)}</span>
                    </a>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      aria-label={`Remove ${game.name} from recent games`}
                      onClick={() => {
                        forgetGame(game.id);
                        setRecent(getRecentGames());
                      }}
                    >
                      <Close size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>

      <footer className="home-footer">
        No accounts, no tracking. Names are only visible to people in your game, and inactive games are deleted automatically.
      </footer>
    </div>
  );
}
