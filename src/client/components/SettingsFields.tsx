import type { GameSettings, Permission } from '../../shared/protocol.ts';
import { Segmented, Switch } from './ui/Controls.tsx';

const PERMISSIONS: Array<{ value: Permission; label: string }> = [
  { value: 'everyone', label: 'All players' },
  { value: 'facilitators', label: 'Only facilitators' },
];

/** The game settings shared by "Create game" and "Game settings". */
export function SettingsFields({ value, onChange }: { value: GameSettings; onChange: (value: GameSettings) => void }) {
  const set = <K extends keyof GameSettings>(key: K, next: GameSettings[K]) => onChange({ ...value, [key]: next });
  return (
    <div className="settings-fields">
      <div className="field">
        <span className="field-label">Who can reveal cards</span>
        <Segmented label="Who can reveal cards" value={value.revealBy} options={PERMISSIONS} onChange={(v) => set('revealBy', v)} />
      </div>
      <div className="field">
        <span className="field-label">Who can manage issues</span>
        <Segmented label="Who can manage issues" value={value.manageIssuesBy} options={PERMISSIONS} onChange={(v) => set('manageIssuesBy', v)} />
      </div>
      <div className="switch-list">
        <Switch
          label="Auto-reveal cards"
          description="Flip the cards as soon as every player has voted."
          checked={value.autoReveal}
          onChange={(v) => set('autoReveal', v)}
        />
        <Switch label="Show average in the results" checked={value.showAverage} onChange={(v) => set('showAverage', v)} />
        <Switch label="Show countdown animation" description="3, 2, 1… before the cards flip." checked={value.countdown} onChange={(v) => set('countdown', v)} />
        <Switch
          label="Enable fun features"
          description="Throw emojis at other players and celebrate consensus with confetti."
          checked={value.funFeatures}
          onChange={(v) => set('funFeatures', v)}
        />
      </div>
    </div>
  );
}
