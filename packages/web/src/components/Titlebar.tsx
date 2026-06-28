// balenaEtcher-style traffic-light titlebar (Conversation & Design Notes.md).
export function Titlebar() {
  return (
    <div className="flex h-10 shrink-0 select-none items-center gap-2 border-b border-border bg-rail px-4">
      <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
      <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
      <span className="h-3 w-3 rounded-full bg-[#28c840]" />
      <div className="ml-3 flex items-center gap-1.5 font-mono text-[12px] font-semibold text-[#c4bdb0]">
        <span className="text-primary">●</span> open-polycom — setup wizard
      </div>
    </div>
  );
}
