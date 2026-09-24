import { THROWABLE_EMOJIS } from '../../shared/limits.ts';
import type { GameState, PlayerView } from '../../shared/protocol.ts';
import type { GameConnection } from '../lib/connection.ts';
import { throwEmoji } from '../lib/emoji.ts';
import { cardLabel } from './CardFace.tsx';
import { Crown, Eye, Pencil, UserX } from './Icons.tsx';
import { Avatar, MenuItem, MenuSeparator } from './ui/Menu.tsx';
import { Popover } from './ui/Popover.tsx';

interface Props {
  target: { player: PlayerView; anchor: HTMLElement } | null;
  onClose: () => void;
  state: GameState;
  conn: GameConnection;
  onRename: () => void;
}

function status(player: PlayerView, state: GameState): string {
  const parts: string[] = [];
  if (player.facilitator) parts.push('Facilitator');
  if (!player.online) parts.push('Reconnecting…');
  else if (player.spectator) parts.push('Spectator');
  else if (state.round.phase === 'revealed') parts.push(player.vote ? `Voted ${cardLabel(player.vote)}` : 'Did not vote');
  else parts.push(player.voted ? 'Voted' : 'Thinking…');
  return parts.join(' · ');
}

/** Clicking a seat: throw emojis at others; facilitators manage players; your own seat edits your profile. */
export function SeatMenu({ target, onClose, state, conn, onRename }: Props) {
  // Use the live player record so the menu reflects changes while it is open.
  const player = target ? (state.players.find((p) => p.id === target.player.id) ?? null) : null;
  if (!target || !player) return null;
  const isMe = player.id === state.you.id;
  const fun = state.game.settings.funFeatures;
  const manage = state.you.can.manageGame && !isMe;
  const appoint = state.you.can.manageFacilitators && !isMe;

  const throwAt = (emoji: string) => {
    if (conn.send({ type: 'emoji', to: player.id, emoji })) throwEmoji(state.you.id, player.id, emoji);
  };

  return (
    <Popover anchor={target.anchor} open onClose={onClose} placement="bottom" label={player.name}>
      <div className="seat-menu">
        <div className="menu-header">
          <Avatar name={player.name} size={36} />
          <div>
            <strong>
              {player.name}
              {isMe && <span className="muted"> (you)</span>}
            </strong>
            <span>{status(player, state)}</span>
          </div>
        </div>
        {!isMe && fun && (
          <>
            <p className="picker-title">Throw something</p>
            <div className="emoji-grid">
              {THROWABLE_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" className="emoji-btn" onClick={() => throwAt(emoji)} aria-label={`Throw ${emoji} at ${player.name}`}>
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
        {isMe && (
          <div className="menu" role="menu">
            <MenuItem
              icon={<Pencil size={18} />}
              onClick={() => {
                onClose();
                onRename();
              }}
            >
              Change name
            </MenuItem>
            <MenuItem icon={<Eye size={18} />} checked={player.spectator} onClick={() => conn.updateProfile({ spectator: !player.spectator })}>
              Spectator mode
            </MenuItem>
          </div>
        )}
        {manage && (
          <div className="menu" role="menu">
            {!isMe && fun && <MenuSeparator />}
            {appoint && (
              <MenuItem
                icon={<Crown size={18} />}
                checked={player.facilitator}
                onClick={() => conn.send({ type: 'facilitator', playerId: player.id, value: !player.facilitator })}
              >
                Facilitator
              </MenuItem>
            )}
            <MenuItem
              icon={<UserX size={18} />}
              danger
              onClick={() => {
                onClose();
                conn.send({ type: 'kick', playerId: player.id });
              }}
            >
              Remove from game
            </MenuItem>
          </div>
        )}
        {!isMe && !fun && !manage && <p className="muted small seat-menu-empty">Fun features are turned off in this game.</p>}
      </div>
    </Popover>
  );
}
