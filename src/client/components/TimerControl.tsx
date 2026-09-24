import { useEffect, useRef } from 'react';
import { TIMER_PRESETS_MS } from '../../shared/limits.ts';
import type { GameState, TimerAction } from '../../shared/protocol.ts';
import type { GameConnection } from '../lib/connection.ts';
import { useNow } from '../lib/hooks.ts';
import { toast } from '../lib/toast.ts';
import { Pause, Play, Timer } from './Icons.tsx';
import { Popover, usePopover } from './ui/Popover.tsx';

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatPreset(ms: number): string {
  return ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000} min`;
}

interface Props {
  state: GameState;
  conn: GameConnection;
  offset: number;
}

/** Shared discussion timer: everyone sees it, facilitators (per settings) control it. */
export function TimerControl({ state, conn, offset }: Props) {
  const { timer, you } = state;
  const running = timer.endsAt !== null;
  const paused = timer.remainingMs !== null;
  const active = running || paused;
  const now = useNow(running, 250);
  const remaining = running ? Math.max(0, timer.endsAt! - (now + offset)) : (timer.remainingMs ?? 0);
  const expired = running && remaining <= 0;
  const popover = usePopover();
  const announced = useRef<number | null>(null);

  useEffect(() => {
    if (!expired || announced.current === timer.endsAt) return;
    announced.current = timer.endsAt;
    // Only announce a fresh expiry, not one that happened before we joined.
    if (Date.now() + offset - timer.endsAt! < 5000) toast("⏰ Time's up!", 'info', 5000);
  }, [expired, timer.endsAt, offset]);

  const send = (action: TimerAction, close = false) => {
    conn.send({ type: 'timer', ...action });
    if (close) popover.close();
  };

  const label = active ? `Timer: ${expired ? "time's up" : `${formatClock(remaining)} left`}${paused ? ' (paused)' : ''}` : 'Start a timer';

  return (
    <>
      <button
        type="button"
        className={`timer-chip${active ? ' is-active' : ''}${expired ? ' is-expired' : ''}${paused ? ' is-paused' : ''}`}
        onClick={popover.toggle}
        aria-label={label}
        title={label}
      >
        <Timer size={18} />
        {active && <span className="timer-time">{formatClock(remaining)}</span>}
      </button>
      <Popover anchor={popover.anchor} open={popover.open} onClose={popover.close} placement="bottom-end" label="Timer">
        <div className="timer-panel">
          {!you.can.reveal ? (
            <p className="muted small">Only facilitators can control the timer in this game.</p>
          ) : !active ? (
            <>
              <p className="picker-title">Timebox the discussion</p>
              <div className="chip-grid">
                {TIMER_PRESETS_MS.map((ms) => (
                  <button key={ms} type="button" className="chip" onClick={() => send({ action: 'start', durationMs: ms }, true)}>
                    {formatPreset(ms)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="picker-title">{expired ? "Time's up!" : paused ? 'Paused' : 'Running'}</p>
              <div className="chip-grid">
                {running && !expired && (
                  <button type="button" className="chip" onClick={() => send({ action: 'pause' })}>
                    <Pause size={14} /> Pause
                  </button>
                )}
                {paused && (
                  <button type="button" className="chip" onClick={() => send({ action: 'resume' })}>
                    <Play size={14} /> Resume
                  </button>
                )}
                <button type="button" className="chip" onClick={() => send({ action: 'add', ms: 30_000 })}>
                  +30s
                </button>
                <button type="button" className="chip" onClick={() => send({ action: 'add', ms: 60_000 })}>
                  +1 min
                </button>
                <button type="button" className="chip chip-danger" onClick={() => send({ action: 'reset' }, true)}>
                  Stop
                </button>
              </div>
            </>
          )}
        </div>
      </Popover>
    </>
  );
}
