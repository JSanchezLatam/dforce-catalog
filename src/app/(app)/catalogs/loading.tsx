export default function CatalogsLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="mb-6 h-[40px] w-56 rounded bg-border/50" />
      <div className="rounded-2xl bg-card p-6 shadow-md">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 flex-1 rounded bg-border/50" />
              <div className="h-4 w-36 rounded bg-border/50" />
              <div className="h-4 w-28 rounded bg-border/50" />
              <div className="h-4 w-20 rounded bg-border/50" />
              <div className="h-4 w-24 rounded bg-border/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
