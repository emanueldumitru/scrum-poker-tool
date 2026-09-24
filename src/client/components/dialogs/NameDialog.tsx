import { type FormEvent, useState } from 'react';
import { LIMITS, cleanText } from '../../../shared/limits.ts';
import { Modal } from '../ui/Modal.tsx';

interface Props {
  onClose: () => void;
  initialName: string;
  onSave: (name: string) => void;
}

/** Mounted only while open, so it always starts from the current name. */
export function NameDialog({ onClose, initialName, onSave }: Props) {
  const [name, setName] = useState(initialName);
  const clean = cleanText(name, LIMITS.playerName);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!clean) return;
    onSave(clean);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Change your display name" size="sm">
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor="rename-input">
            Display name
          </label>
          <input
            id="rename-input"
            className="input"
            value={name}
            maxLength={LIMITS.playerName}
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={!clean}>
          Save
        </button>
      </form>
    </Modal>
  );
}
