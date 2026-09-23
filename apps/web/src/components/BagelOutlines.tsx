const SEEDS = [
  [118, 52],
  [150, 70],
  [172, 104],
  [176, 146],
  [160, 184],
  [70, 60],
  [46, 92],
  [40, 134],
  [58, 176],
] as const;

export function BagelOutlines() {
  return (
    <svg className="bagel-outlines" viewBox="0 0 420 240" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="110" cy="120" r="92" />
        <circle cx="110" cy="120" r="30" />
        <path d="M40 150 q70 40 140 0" />
        {SEEDS.map(([x, y]) => (
          <ellipse
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            rx="5"
            ry="2.5"
            transform={`rotate(${x % 90} ${x} ${y})`}
          />
        ))}
        <circle cx="310" cy="150" r="70" strokeDasharray="4 6" />
        <circle cx="310" cy="150" r="22" strokeDasharray="4 6" />
      </g>
    </svg>
  );
}
