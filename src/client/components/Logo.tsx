export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path
        className="logo-spade"
        d="M20 2.5S5.5 13.4 5.5 21.7c0 4.7 3.6 8.1 7.9 8.1 2.4 0 4.3-1 5.5-2.5-.4 3-1.9 5.6-4.8 7.7h11.8c-2.9-2.1-4.4-4.7-4.8-7.7 1.2 1.5 3.1 2.5 5.5 2.5 4.3 0 7.9-3.4 7.9-8.1C34.5 13.4 20 2.5 20 2.5Z"
      />
      <g transform="rotate(-10 20 19)">
        <rect className="logo-card" x="15" y="12" width="10" height="14" rx="2" />
        <path className="logo-pip" d="M20 15.4s-2.6 1.9-2.6 3.4c0 .8.6 1.4 1.4 1.4.5 0 .9-.2 1.2-.5-.1.6-.4 1.2-1 1.6h2c-.6-.4-.9-1-1-1.6.3.3.7.5 1.2.5.8 0 1.4-.6 1.4-1.4 0-1.5-2.6-3.4-2.6-3.4Z" />
      </g>
    </svg>
  );
}
