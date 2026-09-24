import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { LIMITS, cleanText } from '../../shared/limits.ts';
import { Logo } from '../components/Logo.tsx';
import { Spinner, Switch } from '../components/ui/Controls.tsx';
import { fetchGameInfo } from '../lib/api.ts';
import { type EndReason, type Profile, useGameConnection } from '../lib/connection.ts';
import { navigate } from '../lib/router.ts';
import { forgetGame, getSavedName, getSecret, getSpectatorPreference, saveName, saveSpectatorPreference } from '../lib/storage.ts';
import { GameView } from './GameView.tsx';

type Info = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; name: string };

export function GamePage({ gameId }: { gameId: string }) {
  const [info, setInfo] = useState<Info>({ status: 'loading' });
  const [profile, setProfile] = useState<Profile | null>(() => {
    const name = getSavedName();
    return name ? { name, spectator: getSpectatorPreference(gameId) } : null;
  });
  const [generation, setGeneration] = useState(0);

  const load = useCallback(() => {
    setInfo({ status: 'loading' });
    fetchGameInfo(gameId).then(
      (game) => setInfo(game ? { status: 'ready', name: game.name } : { status: 'missing' }),
      (error: Error) => setInfo({ status: 'error', message: error.message }),
    );
  }, [gameId]);
  useEffect(load, [load]);

  if (info.status === 'loading') return <FullPage><Spinner size={24} /></FullPage>;
  if (info.status === 'missing') return <EndScreen reason="not_found" gameId={gameId} />;
  if (info.status === 'error') {
    return (
      <FullPage>
        <h1>Cannot reach the server</h1>
        <p className="muted">{info.message}</p>
        <button type="button" className="btn btn-primary" onClick={load}>
          Try again
        </button>
      </FullPage>
    );
  }
  if (!profile) {
    return (
      <JoinScreen
        gameName={info.name}
        onJoin={(name, spectator) => {
          saveName(name);
          saveSpectatorPreference(gameId, spectator);
          setProfile({ name, spectator });
        }}
      />
    );
  }
  return <GameRoom key={generation} gameId={gameId} profile={profile} onRejoin={() => setGeneration((g) => g + 1)} />;
}

function GameRoom({ gameId, profile, onRejoin }: { gameId: string; profile: Profile; onRejoin: () => void }) {
  const [secret] = useState(getSecret);
  const { conn, snapshot } = useGameConnection(gameId, profile, secret);
  if (snapshot.ended) return <EndScreen reason={snapshot.ended} gameId={gameId} onRejoin={onRejoin} />;
  if (!snapshot.state) {
    const stuck = snapshot.failures >= 3;
    return (
      <FullPage>
        <Spinner size={24} />
        <p className="muted">{stuck ? 'Cannot reach the game server. Still trying…' : 'Joining the game…'}</p>
        {stuck && <p className="muted small">Check your network connection, or ask whoever runs this app whether it is still running.</p>}
      </FullPage>
    );
  }
  return <GameView conn={conn} snapshot={snapshot} />;
}

function FullPage({ children }: { children: ReactNode }) {
  return (
    <div className="full-page">
      <header className="simple-header">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
          aria-label="Scrum Poker home"
        >
          <Logo size={34} />
        </a>
      </header>
      <main className="full-page-body">{children}</main>
    </div>
  );
}

function JoinScreen({ gameName, onJoin }: { gameName: string; onJoin: (name: string, spectator: boolean) => void }) {
  const [name, setName] = useState('');
  const [spectator, setSpectator] = useState(false);
  const clean = cleanText(name, LIMITS.playerName);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (clean) onJoin(clean, spectator);
  };

  return (
    <FullPage>
      <form className="join-card" onSubmit={submit}>
        <p className="join-eyebrow">You are invited to</p>
        <h1 className="join-game">{gameName}</h1>
        <div className="field">
          <label className="field-label" htmlFor="join-name">
            Choose your display name
          </label>
          <input
            id="join-name"
            className="input input-lg"
            value={name}
            autoFocus
            autoComplete="nickname"
            maxLength={LIMITS.playerName}
            placeholder="Your display name"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Switch
          label="Join as spectator"
          description="Watch the game without voting."
          checked={spectator}
          onChange={setSpectator}
        />
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!clean}>
          Continue to game
        </button>
        <p className="muted small join-privacy">Your name is only shown to the people in this game.</p>
      </form>
    </FullPage>
  );
}

const END_COPY: Record<EndReason, { title: string; text: string }> = {
  not_found: { title: 'Game not found', text: 'This game does not exist or has been deleted. Check the link, or create a new game.' },
  deleted: { title: 'This game was deleted', text: 'A facilitator deleted this game, together with its issues and history.' },
  kicked: { title: 'You are no longer in this game', text: 'You left the game or a facilitator removed you from the table.' },
  full: { title: 'This game is full', text: `A game can seat up to ${LIMITS.playersPerGame} people. Ask the facilitator to remove inactive players, or start a new game.` },
};

function EndScreen({ reason, gameId, onRejoin }: { reason: EndReason; gameId: string; onRejoin?: () => void }) {
  useEffect(() => {
    if (reason === 'not_found' || reason === 'deleted') forgetGame(gameId);
  }, [reason, gameId]);
  const copy = END_COPY[reason];
  const canRetry = (reason === 'kicked' || reason === 'full') && onRejoin;
  return (
    <FullPage>
      <div className="end-card">
        <h1>{copy.title}</h1>
        <p className="muted">{copy.text}</p>
        <div className="end-actions">
          {canRetry && (
            <button type="button" className="btn btn-primary" onClick={onRejoin}>
              {reason === 'full' ? 'Try again' : 'Rejoin the game'}
            </button>
          )}
          <button type="button" className={`btn ${canRetry ? 'btn-ghost' : 'btn-primary'}`} onClick={() => navigate('/')}>
            Create a new game
          </button>
        </div>
      </div>
    </FullPage>
  );
}
