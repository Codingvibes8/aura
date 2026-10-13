import Link from "next/link";

/**
 * Phase 9.1 — offline fallback. Served by the service worker when
 * navigations fail with no cached copy. Quick phrases keep working
 * offline once the shell is cached.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-4xl" aria-hidden="true">
        📡
      </p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">You&apos;re offline</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Live captions, relay calls, and cloud sync need a connection. Your accessibility settings
        and saved phrases are still on this device.
      </p>
      <div className="mt-6 flex gap-2">
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </Link>
        <Link
          href="/dhh"
          className="inline-flex h-11 items-center rounded-xl border border-border bg-card px-5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open DHH view
        </Link>
      </div>
    </div>
  );
}
