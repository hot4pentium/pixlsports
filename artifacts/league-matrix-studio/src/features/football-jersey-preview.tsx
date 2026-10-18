import './football-jersey-preview.css';

export function FootballJerseyPreview({
  name,
  number,
  label,
  accent = '#2878f5',
}: {
  name: string;
  number: string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="football-jersey-preview" style={{ ['--football-jersey-accent' as string]: accent }}>
      <svg viewBox="0 0 440 480" role="img" aria-label={label} data-testid="image-showcase-football-jersey">
        <defs>
          <linearGradient id="football-jersey-fabric" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity=".2" />
            <stop offset=".45" stopColor="var(--football-jersey-accent)" />
            <stop offset="1" stopColor="#071630" stopOpacity=".65" />
          </linearGradient>
          <linearGradient id="football-jersey-shoulder" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity=".24" />
            <stop offset="1" stopColor="#071630" stopOpacity=".08" />
          </linearGradient>
          <filter id="football-jersey-shadow" x="-20%" y="-15%" width="140%" height="145%">
            <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#020914" floodOpacity=".52" />
          </filter>
        </defs>
        <g filter="url(#football-jersey-shadow)">
          <path
            d="M124 53 177 31c12 23 27 34 43 34s31-11 43-34l53 22 97 88-57 73-42-31 8 222c-49 22-99 32-159 32s-110-10-159-32l8-222-42 31-57-73z"
            transform="translate(22 0) scale(.9 1)"
            fill="url(#football-jersey-fabric)"
            stroke="rgba(235,245,255,.52)"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path d="m72 144 69-55 19 37-73 54zm296 0-69-55-19 37 73 54z" fill="url(#football-jersey-shoulder)" />
          <path d="m43 141 70 54m214-54-70 54" fill="none" stroke="rgba(255,255,255,.88)" strokeWidth="13" />
          <path d="m47 153 63 48m220-48-63 48" fill="none" stroke="var(--football-jersey-accent)" strokeWidth="5" />
          <path d="M175 33c13 29 29 43 45 43s32-14 45-43" fill="none" stroke="#f6f8fc" strokeWidth="15" strokeLinecap="round" />
          <path d="M205 71v43" stroke="#f6f8fc" strokeWidth="8" strokeLinecap="round" />
          <path d="m205 79 12 7m-12 2 12 7m-12 2 12 7m-12 2 12 7" fill="none" stroke="#f6f8fc" strokeWidth="4" strokeLinecap="round" data-testid="football-jersey-neck-laces" />
          <path d="M95 183v201m250-201v201" stroke="rgba(255,255,255,.11)" strokeWidth="2" />
          <text x="220" y="177" textAnchor="middle" fill="#fff" fontSize="27" fontWeight="800" letterSpacing="3" fontFamily="DM Sans,sans-serif">
            {name.toUpperCase().slice(0, 14)}
          </text>
          <text x="220" y="322" textAnchor="middle" fill="#fff" fontSize={number.length > 2 ? 118 : 154} fontWeight="900" fontFamily="Barlow Condensed,Impact,sans-serif">
            {number || '—'}
          </text>
          <path d="M142 411q78 24 156 0" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="3" />
        </g>
      </svg>
    </div>
  );
}
