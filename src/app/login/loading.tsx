export default function LoginLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm animate-pulse rounded-2xl bg-card p-6 shadow-md">
        <div className="flex flex-col items-center gap-6 pt-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-border/50 text-sm font-bold" />
            <div className="flex flex-col items-center gap-2">
              <div className="h-7 w-40 rounded bg-border/50" />
              <div className="h-4 w-52 rounded bg-border/50" />
            </div>
          </div>
          <div className="flex w-full flex-col gap-4">
            <div className="h-10 w-full rounded-lg bg-border/50" />
            <div className="h-10 w-full rounded-lg bg-border/50" />
            <div className="mx-auto h-10 w-32 rounded-lg bg-border/50" />
          </div>
        </div>
      </div>
    </main>
  );
}
