// App titlebar — a thin label bar for the framed web window.
export function Titlebar() {
  return (
    <div className="flex h-10 shrink-0 select-none items-center gap-2 border-b border-border bg-rail px-4">
      <div className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-[#c4bdb0]">
        <span className="text-primary">●</span> open-polycom — setup wizard
      </div>
    </div>
  );
}
