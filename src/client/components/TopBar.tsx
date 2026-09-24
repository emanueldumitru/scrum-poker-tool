import type { GameState } from '../../shared/protocol.ts';
import type { GameConnection } from '../lib/connection.ts';
import { navigate } from '../lib/router.ts';
import { setTheme, useTheme } from '../lib/theme.ts';
import { ChevronDown, Eye, History, ListIcon, LogOut, Moon, Pencil, Plus, Refresh, Settings, Sun, UserPlus } from './Icons.tsx';
import { Logo } from './Logo.tsx';
import { TimerControl } from './TimerControl.tsx';
import { Avatar, MenuItem, MenuSeparator } from './ui/Menu.tsx';
import { Popover, usePopover } from './ui/Popover.tsx';

interface Props {
  state: GameState;
  conn: GameConnection;
  offset: number;
  issuesCount: number;
  issuesOpen: boolean;
  onToggleIssues: () => void;
  onInvite: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onRename: () => void;
  onLeave: () => void;
}

export function TopBar(props: Props) {
  const { state, conn, offset, issuesCount, issuesOpen } = props;
  const gameMenu = usePopover();
  const userMenu = usePopover();
  const theme = useTheme();
  const me = state.players.find((p) => p.id === state.you.id);
  const can = state.you.can;

  const run = (close: () => void, action: () => void) => () => {
    close();
    action();
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <a
          href="/"
          className="topbar-logo"
          aria-label="Scrum Poker home"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <Logo size={34} />
        </a>
        <button type="button" className="game-title" onClick={gameMenu.toggle} aria-haspopup="menu" aria-expanded={gameMenu.open}>
          <span className="game-title-text">{state.game.name}</span>
          <ChevronDown size={18} />
        </button>
        <Popover anchor={gameMenu.anchor} open={gameMenu.open} onClose={gameMenu.close} label="Game menu">
          <div className="menu" role="menu">
            <MenuItem
              icon={<Settings size={18} />}
              onClick={run(gameMenu.close, props.onSettings)}
              disabled={!can.manageGame}
              hint={can.manageGame ? undefined : 'Only facilitators'}
            >
              Game settings
            </MenuItem>
            <MenuItem icon={<History size={18} />} onClick={run(gameMenu.close, props.onHistory)}>
              Voting history
            </MenuItem>
            <MenuItem icon={<UserPlus size={18} />} onClick={run(gameMenu.close, props.onInvite)}>
              Invite players
            </MenuItem>
            {can.reveal && state.round.phase !== 'revealed' && state.players.some((p) => p.voted) && (
              <MenuItem icon={<Refresh size={18} />} onClick={run(gameMenu.close, () => conn.send({ type: 'reset' }))} hint="Everyone votes from scratch">
                Clear votes
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<Plus size={18} />} onClick={run(gameMenu.close, () => navigate('/'))}>
              New game
            </MenuItem>
          </div>
        </Popover>
      </div>

      <div className="topbar-right">
        <TimerControl state={state} conn={conn} offset={offset} />
        <button type="button" className="btn btn-outline topbar-invite" onClick={props.onInvite}>
          <UserPlus size={18} />
          <span>Invite players</span>
        </button>
        {me && (
          <>
            <button type="button" className="user-chip" onClick={userMenu.toggle} aria-haspopup="menu" aria-expanded={userMenu.open}>
              <Avatar name={me.name} size={32} />
              <span className="user-chip-name">{me.name}</span>
              <ChevronDown size={16} />
            </button>
            <Popover anchor={userMenu.anchor} open={userMenu.open} onClose={userMenu.close} placement="bottom-end" label="Your profile">
              <div className="menu" role="menu">
                <div className="menu-header">
                  <Avatar name={me.name} size={36} />
                  <div>
                    <strong>{me.name}</strong>
                    <span>{me.facilitator ? 'Facilitator' : me.spectator ? 'Spectator' : 'Player'}</span>
                  </div>
                </div>
                <MenuItem icon={<Pencil size={18} />} onClick={run(userMenu.close, props.onRename)}>
                  Change name
                </MenuItem>
                <MenuItem icon={<Eye size={18} />} checked={me.spectator} onClick={() => conn.updateProfile({ spectator: !me.spectator })}>
                  Spectator mode
                </MenuItem>
                <MenuItem
                  icon={theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<LogOut size={18} />} danger onClick={run(userMenu.close, props.onLeave)}>
                  Leave game
                </MenuItem>
              </div>
            </Popover>
          </>
        )}
        <button
          type="button"
          className={`icon-btn issues-toggle${issuesOpen ? ' is-active' : ''}`}
          onClick={props.onToggleIssues}
          aria-label={issuesOpen ? 'Hide issues' : 'Show issues'}
          aria-pressed={issuesOpen}
          title="Issues"
        >
          <ListIcon />
          {issuesCount > 0 && <span className="badge">{issuesCount > 99 ? '99+' : issuesCount}</span>}
        </button>
      </div>
    </header>
  );
}
