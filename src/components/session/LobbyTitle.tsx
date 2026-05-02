import Link from 'next/link';
import { RotatingTagline } from './RotatingTagline';

export function LobbyTitle({
  size = 'hero',
  withTagline = true,
}: {
  size?: 'hero' | 'small';
  withTagline?: boolean;
}) {
  const isHero = size === 'hero';
  return (
    <div className={isHero ? 'px-7 pt-10 pb-7' : 'px-7 pt-7 pb-5'}>
      <h1
        className={`m-0 font-serif font-normal leading-[0.9] tracking-[-0.04em] text-mise-fg ${
          isHero ? 'text-[clamp(64px,12vw,104px)]' : 'text-[40px]'
        }`}
      >
        <Link href="/" className="text-inherit no-underline">
          mise<span className="text-mise-accent">.</span>
        </Link>
      </h1>
      {withTagline && (
        <div className="mt-2">
          <RotatingTagline />
        </div>
      )}
    </div>
  );
}
