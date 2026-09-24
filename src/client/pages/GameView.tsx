import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerView } from '../../shared/protocol.ts';
import { Deck } from '../components/Deck.tsx';
import { HistoryDialog } from '../components/dialogs/HistoryDialog.tsx';
import { InviteDialog } from '../components/dialogs/InviteDialog.tsx';
import { NameDialog } from '../components/dialogs/NameDialog.tsx';
import { SettingsDialog } from '../components/dialogs/SettingsDialog.tsx';
import { ExternalLink } from '../components/Icons.tsx';
import { IssuesPanel } from '../components/IssuesPanel.tsx';
import { Results } from '../components/Results.tsx';
import { SeatMenu } from '../components/SeatMenu.tsx';
import { Table } from '../components/Table.tsx';
import { TableCenter } from '../components/TableCenter.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { Spinner } from '../components/ui/Controls.tsx';
import { fireConfetti } from '../lib/confetti.ts';
import type { GameConnection, GameSnapshot } from '../lib/connection.ts';
import { throwEmoji } from '../lib/emoji.ts';
import { navigate } from '../lib/router.ts';
import { rememberGame, saveName, saveSpectatorPreference } from '../lib/storage.ts';
import { toast } from '../lib/toast.ts';

type Dialog = 'invite' | 'settings' | 'history' | 'rename' | null;

interface Props {
  conn: GameConnection;
  snapshot: GameSnapshot;
}

export function GameView({ conn, snapshot }: Props) {
  const state = snapshot.state!;
  const { round, game } = state;
  const me = state.players.find((p) => p.id === state.you.id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [seatTarget, setSeatTarget] = useState<{ player: PlayerView; anchor: HTMLElement } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const lastPhase = useRef(round.phase);

  const activeIssue = useMemo(() => snapshot.issues.find((i) => i.id === round.issueId) ?? null, [snapshot.issues, round.issueId]);
  const nextIssue = useMemo(() => {
    const index = snapshot.issues.findIndex((i) => i.id === state.activeIssueId);
    const ordered = [...snapshot.issues.slice(index + 1), ...snapshot.issues.slice(0, Math.max(0, index))];
    return ordered.find((i) => i.estimate === null && i.id !== state.activeIssueId) ?? null;
  }, [snapshot.issues, state.activeIssueId]);

  // Errors and emoji throws from the server.
  useEffect(
    () =>
      conn.onEvent((event) => {
        if (event.kind === 'error') toast(event.message, event.code === 'offline' ? 'info' : 'error');
        else if (event.from !== state.you.id) throwEmoji(event.from, event.to, event.emoji);
      }),
    [conn, state.you.id],
  );

  // Remember the game locally (recent games list, name, spectator preference).
  useEffect(() => {
    rememberGame({ id: game.id, name: game.name });
    document.title = `${game.name} · Scrum Poker`;
    return () => {
      document.title = 'Scrum Poker';
    };
  }, [game.id, game.name]);
  const myName = me?.name;
  const mySpectator = me?.spectator;
  useEffect(() => {
    if (myName === undefined || mySpectator === undefined) return;
    saveName(myName);
    saveSpectatorPreference(game.id, mySpectator);
  }, [game.id, myName, mySpectator]);

  // Confetti for full consensus (at least two estimates) — only when we watched the reveal
  // happen, not when joining a game whose cards are already face up.
  const stats = round.stats;
  const celebrate = Boolean(stats?.consensus && stats.voteCount >= 2 && game.settings.funFeatures);
  useEffect(() => {
    const previous = lastPhase.current;
    lastPhase.current = round.phase;
    if (round.phase !== 'revealed' || previous === 'revealed' || !celebrate) return;
    const rect = tableRef.current?.querySelector('.table')?.getBoundingClientRect();
    const origin = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
    const timer = window.setTimeout(() => fireConfetti(origin), 350);
    return () => window.clearTimeout(timer);
  }, [round.phase, round.number, celebrate]);

  const openSeat = useCallback((player: PlayerView, anchor: HTMLElement) => {
    setSeatTarget((current) => (current?.player.id === player.id ? null : { player, anchor }));
  }, []);

  const leave = () => {
    conn.send({ type: 'leave' });
    navigate('/');
  };

  const announcement =
    round.phase === 'revealed' ? `Cards revealed. ${round.result ? `Result: ${round.result}.` : 'No estimate.'}` : round.phase === 'revealing' ? 'Revealing cards…' : '';

  return (
    <div className={`game${issuesOpen ? ' with-issues' : ''}`}>
      <TopBar
        state={state}
        conn={conn}
        offset={snapshot.offset}
        issuesCount={snapshot.issues.length}
        issuesOpen={issuesOpen}
        onToggleIssues={() => setIssuesOpen((open) => !open)}
        onInvite={() => setDialog('invite')}
        onSettings={() => setDialog('settings')}
        onHistory={() => setDialog('history')}
        onRename={() => setDialog('rename')}
        onLeave={leave}
      />

      {snapshot.status !== 'online' && (
        <div className="connection-banner" role="status">
          <Spinner size={14} /> Connection lost. Reconnecting…
        </div>
      )}

      <main className="stage">
        <div className="stage-top">
          {activeIssue && (
            <div className="issue-banner">
              <span className="issue-banner-label">Voting on</span>
              <span className="issue-banner-title" title={activeIssue.title}>
                {activeIssue.title}
              </span>
              {activeIssue.link && (
                <a href={activeIssue.link} target="_blank" rel="noopener noreferrer" className="issue-banner-link" aria-label="Open issue">
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          )}
        </div>
        <div className="stage-table" ref={tableRef}>
          <Table state={state} onSeatOpen={openSeat}>
            <TableCenter state={state} conn={conn} offset={snapshot.offset} onInvite={() => setDialog('invite')} />
          </Table>
        </div>
        <div className="stage-bottom">{round.phase === 'revealed' ? <Results state={state} conn={conn} nextIssue={nextIssue} /> : <Deck state={state} conn={conn} />}</div>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </main>

      <IssuesPanel open={issuesOpen} onClose={() => setIssuesOpen(false)} state={state} issues={snapshot.issues} conn={conn} />

      <SeatMenu target={seatTarget} onClose={() => setSeatTarget(null)} state={state} conn={conn} onRename={() => setDialog('rename')} />
      <InviteDialog open={dialog === 'invite'} onClose={() => setDialog(null)} gameId={game.id} />
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} state={state} conn={conn} />}
      {dialog === 'history' && <HistoryDialog onClose={() => setDialog(null)} state={state} conn={conn} history={snapshot.history} />}
      {dialog === 'rename' && me && (
        <NameDialog
          onClose={() => setDialog(null)}
          initialName={me.name}
          onSave={(name) => {
            conn.updateProfile({ name });
            saveName(name);
          }}
        />
      )}
    </div>
  );
}
