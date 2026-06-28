// AppWindow — the balenaEtcher-style window floating on a dotted backdrop. Native
// (Tauri) would fill its own window; on web it caps at 1120px and sits framed.
// Routes by phase and keeps the Console pane mounted across the whole flow.
import { useWizard } from "@/lib/wizard";
import { Titlebar } from "./Titlebar";
import { Console } from "./Console";
import { DevicePicker } from "./DevicePicker";
import { FlowPicker } from "./FlowPicker";
import { FlowView } from "./FlowView";

export function AppWindow() {
  const { phase } = useWizard();
  return (
    <div className="backdrop-dots flex min-h-screen w-full items-center justify-center p-4 sm:p-8">
      <div className="flex h-[min(82vh,760px)] w-full max-w-[1120px] flex-col overflow-hidden rounded-xl bg-background shadow-window ring-1 ring-black/5">
        <Titlebar />
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            {phase === "pick-device" && <DevicePicker />}
            {phase === "pick-flow" && <FlowPicker />}
            {phase === "in-flow" && <FlowView />}
          </section>
          <Console />
        </div>
      </div>
    </div>
  );
}
