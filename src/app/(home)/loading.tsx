import { LobbyTitle } from '@/components/session/LobbyTitle';
import { LobbyTopBar } from '@/components/session/LobbyTopBar';

/**
 * Default route-segment loading UI. Renders the same lobby chrome the home
 * page uses so navigations from /history → / (and similar) feel like a
 * content swap inside a stable shell, not a full page replacement.
 */
export default function Loading() {
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
      </div>
    </div>
  );
}
