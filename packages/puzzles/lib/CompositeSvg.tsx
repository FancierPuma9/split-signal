import { useId } from 'react';
import type { Look } from './composite';

const FILL: Record<Look['color'], string> = {
  red: '#e5484d',
  blue: '#1a8cff',
  yellow: '#f5b83d',
  green: '#30a46c',
  purple: '#8e4ec6',
};

const OUTLINE: Record<Look['shape'], string> = {
  circle: 'M32 8a24 24 0 1 1 0 48a24 24 0 1 1 0-48z',
  square: 'M10 10h44v44H10z',
  triangle: 'M32 6l27 50H5z',
  hexagon: 'M32 6l23 13v26L32 58 9 45V19z',
  diamond: 'M32 4l26 28-26 28L6 32z',
};

function Motif({ motif }: { motif: Look['motif'] }) {
  const ink = '#fff';
  switch (motif) {
    case 'star':
      return (
        <path
          d="M32 22l3 7 7.5.6-5.7 5 1.8 7.4L32 38l-6.6 4 1.8-7.4-5.7-5 7.5-.6z"
          fill={ink}
          stroke="#1b1e25"
          strokeWidth="1"
        />
      );
    case 'dot':
      return <circle cx="32" cy="34" r="5.5" fill={ink} stroke="#1b1e25" strokeWidth="1" />;
    case 'cross':
      return <path d="M32 25v18M23 34h18" stroke={ink} strokeWidth="4.5" strokeLinecap="round" />;
    case 'ring':
      return <circle cx="32" cy="34" r="7" fill="none" stroke={ink} strokeWidth="3.5" />;
    case 'none':
      return null;
  }
}

/** Draws a composite picture: shape, color, fill pattern and motif. No text anywhere. */
export function CompositeSvg({ look, size = 64 }: { look: Look; size?: number }) {
  const id = useId().replace(/:/g, '');
  const color = FILL[look.color];
  const fill =
    look.pattern === 'solid'
      ? color
      : look.pattern === 'hollow'
        ? 'none'
        : `url(#${id}-${look.pattern})`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <pattern
          id={`${id}-striped`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill="#1b1e25" />
          <rect width="4" height="8" fill={color} />
        </pattern>
        <pattern id={`${id}-dotted`} width="9" height="9" patternUnits="userSpaceOnUse">
          <rect width="9" height="9" fill="#1b1e25" />
          <circle cx="4.5" cy="4.5" r="2.6" fill={color} />
        </pattern>
      </defs>
      <path
        d={OUTLINE[look.shape]}
        fill={fill}
        stroke={color}
        strokeWidth={look.pattern === 'hollow' ? 4 : 2}
      />
      <Motif motif={look.motif} />
    </svg>
  );
}
