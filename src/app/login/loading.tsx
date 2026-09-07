export default function LoginLoading() {
  return (
    <main className="grid h-screen grid-cols-1 overflow-hidden bg-muted text-foreground lg:grid-cols-2">
      <section className="relative flex h-full items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="absolute right-5 top-5 h-11 w-36 animate-pulse rounded-full border border-border bg-card shadow-[0_10px_30px_rgb(0_0_0_/_0.12)]" />
        <div className="w-full max-w-[400px] animate-pulse rounded-3xl border border-border bg-card px-8 py-9 shadow-[0_24px_70px_rgb(15_23_42_/_0.16)] dark:shadow-[0_28px_80px_rgb(0_0_0_/_0.36)] sm:px-9">
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
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
          <div className="h-3 w-44 rounded bg-border/50" />
          <div className="h-3 w-40 rounded bg-border/40" />
        </div>
      </section>
      <section className="relative hidden h-full overflow-hidden bg-card lg:block" aria-hidden="true">
        <div className="h-full w-full animate-pulse bg-border/40" />
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
