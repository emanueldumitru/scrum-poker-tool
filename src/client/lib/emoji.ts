import { prefersReducedMotion } from './hooks.ts';

let layer: HTMLDivElement | null = null;
let inFlight = 0;

function getLayer(): HTMLDivElement {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'emoji-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

function seatCard(playerId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-seat="${CSS.escape(playerId)}"] .seat-card`);
}

function center(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const place = (x: number, y: number, extra = '') => `translate(${x}px, ${y}px) translate(-50%, -50%) ${extra}`;

/** Throws `emoji` from one seat to another along an arc, then bounces it off the card. */
export function throwEmoji(fromId: string, toId: string, emoji: string): void {
  const target = seatCard(toId);
  if (!target || inFlight > 40) return;
  const source = seatCard(fromId);
  const end = center(target);
  const start = source ? center(source) : { x: window.innerWidth / 2, y: window.innerHeight + 30 };

  const el = document.createElement('span');
  el.className = 'thrown-emoji';
  el.textContent = emoji;
  getLayer().appendChild(el);
  inFlight++;
  const done = () => {
    el.remove();
    inFlight--;
  };

  if (prefersReducedMotion()) {
    el.animate(
      [
        { transform: place(end.x, end.y - 30, 'scale(0.6)'), opacity: 0 },
        { transform: place(end.x, end.y - 40, 'scale(1)'), opacity: 1, offset: 0.3 },
        { transform: place(end.x, end.y - 40, 'scale(1)'), opacity: 0 },
      ],
      { duration: 900 },
    ).onfinish = done;
    return;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const lift = Math.min(180, 50 + distance * 0.35);
  const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = start.x + dx * t;
    const y = start.y + dy * t - lift * 4 * t * (1 - t);
    frames.push({ transform: place(x, y, `rotate(${spin * t}deg) scale(${0.7 + 0.5 * Math.sin(Math.PI * t)})`), offset: t });
  }
  const flight = el.animate(frames, { duration: Math.min(1100, 450 + distance * 0.6), easing: 'cubic-bezier(.3,.1,.5,1)' });
  flight.onfinish = () => {
    target.classList.remove('is-hit');
    void target.offsetWidth; // restart the CSS animation
    target.classList.add('is-hit');
    window.setTimeout(() => target.classList.remove('is-hit'), 500);
    const bounceX = end.x + (dx >= 0 ? 1 : -1) * (30 + Math.random() * 40);
    el.animate(
      [
        { transform: place(end.x, end.y, 'scale(1)'), opacity: 1 },
        { transform: place((end.x + bounceX) / 2, end.y - 36, 'rotate(40deg) scale(0.9)'), opacity: 1, offset: 0.4 },
        { transform: place(bounceX, end.y + 30, 'rotate(90deg) scale(0.6)'), opacity: 0 },
      ],
      { duration: 550, easing: 'ease-out' },
    ).onfinish = done;
  };
}
