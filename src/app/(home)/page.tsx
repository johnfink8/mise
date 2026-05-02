import { Suspense } from 'react';
import { CatalogStatus } from '@/components/session/CatalogStatus';
import { HomeStart } from '@/components/session/HomeStart';
import { LobbyTitle } from '@/components/session/LobbyTitle';
import { LobbyTopBar } from '@/components/session/LobbyTopBar';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <LobbyTopBar status="initial" />

      <div className="mx-auto w-full max-w-[980px] flex-1 px-5 sm:px-7">
        <LobbyTitle size="hero" />

        <div className="max-w-[560px] px-7 pb-7">
          <p className="m-0 font-serif text-[18px] italic leading-[1.5] text-mise-fg-dim">
            Tell me what you&rsquo;re in the mood for. I&rsquo;ll comb through your Plex
            library and pull a programme together. Send a follow-up to refine.
          </p>
        </div>

        <Suspense fallback={<CatalogStatusFallback />}>
          <CatalogStatus />
        </Suspense>
      </div>

      <HomeStart />
    </div>
  );
}

/**
 * Reserve the vertical space the eyebrow line will occupy so the layout
 * doesn't jump when the real stats stream in. Banners only show on edge cases
 * (empty catalog, mid-refresh) so the fallback omits them.
 */
function CatalogStatusFallback() {
  return <div className="eyebrow px-7 pb-3 pt-6 opacity-0">mise</div>;
}
