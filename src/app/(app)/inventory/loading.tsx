export default function InventoryLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="mb-6 flex items-center gap-3">
        <div className="h-5 w-24 rounded bg-border/50" />
        <div className="h-5 w-24 rounded bg-border/50" />
        <div className="h-5 w-24 rounded bg-border/50" />
      </div>
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
    </div>
  );
}
