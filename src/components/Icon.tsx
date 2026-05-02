import type { CSSProperties, SVGProps } from 'react';

export type IconName =
  | 'arrow'
  | 'chevron'
  | 'history'
  | 'play'
  | 'plus'
  | 'thumbsUp'
  | 'thumbsDown'
  | 'x'
  | 'sparkle';

interface Props {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, stroke = 1.5, style }: Props) {
  const props: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: {
      width: size,
      height: size,
      display: 'inline-block',
      verticalAlign: 'middle',
      ...style,
    },
  };

  switch (name) {
    case 'arrow':
      return (
        <svg {...props}>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...props}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'history':
      return (
        <svg {...props}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'play':
      return (
        <svg {...props}>
          <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'thumbsUp':
      return (
        <svg {...props}>
          <path d="M7 10v11" />
          <path d="M14 4l-1 6h7a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.6 21H7V10l5-6a2 2 0 0 1 2 0z" />
        </svg>
      );
    case 'thumbsDown':
      return (
        <svg {...props}>
          <path d="M17 14V3" />
          <path d="M10 20l1-6H4a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 5.4 3H17v11l-5 6a2 2 0 0 1-2 0z" />
        </svg>
      );
    case 'x':
      return (
        <svg {...props}>
          <path d="M18 6 6 18" />
          <path d="M6 6l12 12" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...props}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.5 2.5M16 16l2.5 2.5M5.5 18.5 8 16M16 8l2.5-2.5" />
        </svg>
      );
    default:
      return null;
  }
}
