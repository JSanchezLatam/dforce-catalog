export default function AppLoading() {
  return (
    <div className="flex min-h-screen">
      <aside className="flex h-screen w-[72px] shrink-0 flex-col justify-between bg-card animate-pulse">
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="h-8 w-8 rounded-lg bg-border/50" />
          <hr className="w-full border-border/50" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-6 w-6 rounded bg-border/50" />
            ))}
          </div>
        </div>
        <div className="mb-4 flex justify-center">
          <div className="h-5 w-5 rounded bg-border/50" />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8 animate-pulse">
        <div className="mb-6 h-[40px] w-48 rounded bg-border/50" />
        <div className="rounded-2xl bg-card p-6 shadow-md">
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="h-4 flex-1 rounded bg-border/50" />
                <div className="h-4 w-32 rounded bg-border/50" />
                <div className="h-4 w-24 rounded bg-border/50" />
                <div className="h-4 w-20 rounded bg-border/50" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
