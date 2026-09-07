export default function LoginLoading() {
  return (
    <main className="grid min-h-dvh grid-cols-1 bg-muted text-foreground lg:grid-cols-2">
      <section className="flex flex-col items-center px-5 py-10 sm:px-8 lg:px-12">
        {/* No toggle placeholder on purpose. `LoginThemeToggle` returns null
            until it is hydrated, so painting a pill here would show one, drop
            it the moment the real page mounted, and bring it back a tick
            later. An honest skeleton omits what the page does not render
            yet. */}
        <div className="my-auto w-full max-w-[400px] animate-pulse rounded-3xl border border-border bg-card px-8 py-9 shadow-[0_24px_70px_rgb(15_23_42_/_0.16)] dark:shadow-[0_28px_80px_rgb(0_0_0_/_0.36)] sm:px-9">
          <div className="mx-auto mb-6 h-16 w-[200px] rounded-2xl bg-border/50" />
          <div className="mb-7 flex flex-col items-center gap-2">
            <div className="h-7 w-56 rounded bg-border/50" />
            <div className="h-4 w-48 rounded bg-border/50" />
          </div>
          <div className="flex w-full flex-col gap-4">
            <div className="space-y-2">
              <div className="h-4 w-16 rounded bg-border/50" />
              <div className="h-11 w-full rounded-xl bg-border/50" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-24 rounded bg-border/50" />
              <div className="h-11 w-full rounded-xl bg-border/50" />
            </div>
            <div className="h-11 w-full rounded-xl bg-border/60" />
          </div>
        </div>
        <div className="mt-6 flex flex-col items-center gap-1">
          <div className="h-3 w-44 rounded bg-border/50" />
          <div className="h-3 w-40 rounded bg-border/40" />
        </div>
      </section>
      <section className="relative hidden overflow-hidden bg-card lg:block" aria-hidden="true">
        {/* Mirrors the real hero in page.tsx, which had to leave the flow: there
            the <img> has an intrinsic size, so in flow it drove the row height
            itself and `h-full` resolved against its own aspect ratio. This
            placeholder is empty and never had that problem — measured identical
            at 900px either way — but it matches the file it mirrors. */}
        <div className="absolute inset-0 animate-pulse bg-border/40" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.55)_30%,rgba(0,0,0,0.10)_65%,rgba(0,0,0,0.25)_100%)]" />
        <div className="absolute bottom-10 left-10 flex flex-col gap-3">
          <div className="h-9 w-72 rounded bg-white/25" />
          <div className="h-9 w-32 rounded bg-white/20" />
          <div className="h-5 w-80 rounded bg-white/15" />
        </div>
      </section>
    </main>
  );
}
