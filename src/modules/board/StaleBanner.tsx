/** Shown only after a failed poll, so the server render never contains it (no hydration mismatch). */
export function StaleBanner({ lastOkAt, failedAt }: { lastOkAt: number; failedAt: number | null }) {
  if (failedAt === null) return null;
  const minutes = Math.floor((failedAt - lastOkAt) / 60_000);
  if (minutes < 1) return null;
  return (
    <div role="status" className="mb-4 rounded-xl bg-amber-100 px-4 py-3 text-xl font-medium text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
      {`Sin conexión · actualizado hace ${minutes} min`}
    </div>
  );
}
