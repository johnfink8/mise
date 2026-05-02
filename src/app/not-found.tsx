import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-[980px] px-7 py-10">
      <h2 className="m-0 font-serif text-[48px] font-normal tracking-[-0.03em] text-mise-fg">
        not found<span className="text-mise-accent">.</span>
      </h2>
      <p className="mt-4 font-serif text-[18px] italic text-mise-fg-dim">
        that page doesn&rsquo;t exist.
      </p>
      <p className="mt-4">
        <Link href="/" className="text-mise-accent hover:underline">
          ← back home
        </Link>
      </p>
    </main>
  );
}
