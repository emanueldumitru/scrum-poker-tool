import { type FormEvent, useState } from 'react';
import { resolveDeck, sameDeck } from '../../../shared/decks.ts';
import { LIMITS, cleanText } from '../../../shared/limits.ts';
import type { GameSettings, GameState } from '../../../shared/protocol.ts';
import type { GameConnection } from '../../lib/connection.ts';
import { toast } from '../../lib/toast.ts';
import { DEFAULT_CUSTOM_CARDS, type DeckChoice, DeckPicker, deckInputFor } from '../DeckPicker.tsx';
import { SettingsFields } from '../SettingsFields.tsx';
import { Crown } from '../Icons.tsx';
import { Confirm } from '../ui/Confirm.tsx';
import { Switch } from '../ui/Controls.tsx';
import { Avatar } from '../ui/Menu.tsx';
import { Modal } from '../ui/Modal.tsx';

interface Props {
  onClose: () => void;
  state: GameState;
  conn: GameConnection;
}

/**
 * Mounted only while open, so the form starts from the live values and later state
 * updates from other players never overwrite what the facilitator is typing.
 */
export function SettingsDialog({ onClose, state, conn }: Props) {
  const { game, players, you } = state;
  const [name, setName] = useState(game.name);
  const [deck, setDeck] = useState<DeckChoice>(() => ({
    id: game.deck.id,
    custom: game.deck.id === 'custom' ? game.deck.cards.join(', ') : DEFAULT_CUSTOM_CARDS,
  }));
  const [settings, setSettings] = useState<GameSettings>(game.settings);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const cleanName = cleanText(name, LIMITS.gameName);
  const resolved = resolveDeck(deckInputFor(deck));
  const deckChanged = resolved.ok && !sameDeck(resolved.deck, game.deck);
  const hasVotes = players.some((p) => p.voted);
  const noFacilitatorSeated = !players.some((p) => p.facilitator);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!cleanName || !resolved.ok) return;
    const sent = conn.send({
      type: 'settings',
      name: cleanName !== game.name ? cleanName : undefined,
      deck: deckChanged ? deckInputFor(deck) : undefined,
      settings,
    });
    if (sent) {
      toast('Game settings saved', 'success');
      onClose();
    }
  };

  return (
    <Modal open onClose={onClose} title="Game settings" size="md">
      <form className="stack" onSubmit={save} id="settings-form">
        <div className="field">
          <label className="field-label" htmlFor="settings-name">
            Game's name
          </label>
          <input id="settings-name" className="input" value={name} maxLength={LIMITS.gameName} onChange={(e) => setName(e.target.value)} />
        </div>
        <DeckPicker value={deck} onChange={setDeck} />
        {deckChanged && hasVotes && <p className="notice">Changing the voting system clears the current votes and starts a new round.</p>}
        <SettingsFields value={settings} onChange={setSettings} />

        <section className="settings-section">
          <h3>Facilitators</h3>
          <p className="muted small">
            Facilitators can always reveal cards, manage issues and change these settings. When no facilitator is at the table, everyone
            can run the game — but only facilitators can choose facilitators or delete the game.
            {noFacilitatorSeated && ' No facilitator is at the table right now.'}
          </p>
          <ul className="people-list">
            {players.map((player) => (
              <li key={player.id}>
                <Avatar name={player.name} size={28} />
                <span className="people-name">
                  {player.name}
                  {player.id === you.id && <span className="muted"> (you)</span>}
                </span>
                <Switch
                  label={
                    <span className="sr-only">
                      {player.name} is {player.facilitator ? '' : 'not '}a facilitator
                    </span>
                  }
                  checked={player.facilitator}
                  disabled={!you.can.manageFacilitators}
                  onChange={(value) => conn.send({ type: 'facilitator', playerId: player.id, value })}
                />
                {player.facilitator && <Crown size={14} className="people-crown" />}
              </li>
            ))}
          </ul>
        </section>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!cleanName || !resolved.ok}>
            Save settings
          </button>
        </div>

        {you.can.deleteGame && (
          <section className="settings-section danger-zone">
            <div>
              <h3>Delete this game</h3>
              <p className="muted small">Removes the game, its issues and voting history for everyone. This cannot be undone.</p>
            </div>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
              Delete game
            </button>
          </section>
        )}
      </form>
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this game?"
        message={`"${game.name}" and all of its data will be deleted for everyone.`}
        confirmLabel="Delete game"
        danger
        onConfirm={() => conn.send({ type: 'delete' })}
      />
    </Modal>
  );
}
