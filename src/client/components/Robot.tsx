import type { AgreementMood } from '../../shared/stats.ts';

export const MOOD_MESSAGES: Record<AgreementMood, string> = {
  consensus: 'Yeah! You reached full consensus.',
  solo: 'Only one estimate this round — nothing to compare yet.',
  high: 'So close! Almost everyone agrees.',
  close: 'Close call — the votes are just one card apart.',
  medium: 'Some different views. Worth a quick chat.',
  low: 'Opinions differ a lot. Time to discuss!',
  none: 'Nobody estimated this round.',
};

const R = 21;
const CIRCUMFERENCE = 2 * Math.PI * R;

function Eyes({ mood }: { mood: AgreementMood }) {
  if (mood === 'consensus' || mood === 'high') {
    return <path className="robot-stroke" d="M18.2 22.6q1.8-2.4 3.6 0M26.2 22.6q1.8-2.4 3.6 0" />;
  }
  if (mood === 'none') return <path className="robot-stroke" d="M18.5 21.8h3M26.5 21.8h3" />;
  if (mood === 'low') {
    return (
      <>
        <circle className="robot-fill" cx="20" cy="22" r="2.1" />
        <circle className="robot-fill" cx="28" cy="22" r="2.1" />
        <path className="robot-stroke" d="M17.8 18.6l3.6 1M30.2 18.6l-3.6 1" />
      </>
    );
  }
  return (
    <>
      <circle className="robot-fill" cx="20" cy="21.8" r="1.7" />
      <circle className="robot-fill" cx="28" cy="21.8" r="1.7" />
    </>
  );
}

function Mouth({ mood }: { mood: AgreementMood }) {
  switch (mood) {
    case 'consensus':
      return <path className="robot-fill" d="M19 25.4q5 5.6 10 0Z" />;
    case 'high':
      return <path className="robot-stroke" d="M19.6 25.6q4.4 3.8 8.8 0" />;
    case 'solo':
    case 'close':
      return <path className="robot-stroke" d="M20.4 26.2q3.6 2.2 7.2 0" />;
    case 'medium':
      return <path className="robot-stroke" d="M20.6 26.8h6.8" />;
    case 'low':
      return <path className="robot-stroke" d="M20.2 28q3.8-3 7.6 0" />;
    case 'none':
      return <circle className="robot-stroke" cx="24" cy="26.8" r="1.4" />;
  }
}

/** The agreement ring with a robot whose face reacts to how aligned the votes are. */
export function Robot({ mood, value }: { mood: AgreementMood; value: number }) {
  return (
    <svg className={`robot mood-${mood}`} width="52" height="52" viewBox="0 0 48 48" aria-hidden="true">
      <circle className="robot-track" cx="24" cy="24" r={R} />
      <circle
        className="robot-progress"
        cx="24"
        cy="24"
        r={R}
        strokeDasharray={`${CIRCUMFERENCE * Math.max(0, Math.min(1, value))} ${CIRCUMFERENCE}`}
        transform="rotate(-90 24 24)"
      />
      {mood === 'consensus' && (
        <g className="robot-confetti">
          <circle cx="12.5" cy="14" r="1.2" className="c1" />
          <circle cx="35.5" cy="13" r="1.1" className="c2" />
          <rect x="10" y="30" width="2.2" height="2.2" rx="0.4" className="c3" transform="rotate(20 11 31)" />
          <circle cx="37" cy="31.5" r="1.2" className="c4" />
          <rect x="30" y="8.5" width="2" height="2" rx="0.4" className="c1" transform="rotate(-25 31 9.5)" />
          <circle cx="16.5" cy="9.5" r="0.9" className="c3" />
          <circle cx="24" cy="37" r="1" className="c2" />
        </g>
      )}
      <path className="robot-stroke" d="M24 15.5V12.6" />
      <circle className="robot-fill" cx="24" cy="11.4" r="1.7" />
      <rect className="robot-head" x="14.5" y="15.5" width="19" height="15.5" rx="4.5" />
      <rect className="robot-fill" x="12" y="20.6" width="2.5" height="5.2" rx="1" />
      <rect className="robot-fill" x="33.5" y="20.6" width="2.5" height="5.2" rx="1" />
      <Eyes mood={mood} />
      <Mouth mood={mood} />
    </svg>
  );
}
