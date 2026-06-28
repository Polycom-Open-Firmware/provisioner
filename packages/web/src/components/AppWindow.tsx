// AppWindow — on web, the wizard floats in a balenaEtcher-style fake window
// (traffic-light titlebar on a dotted backdrop) because it lives in a browser
// tab. Native (Tauri) is already a real OS window, so we drop that chrome and
// fill the window — otherwise you get a window nested in a window.
import { useWizard } from "@/lib/wizard";
import { isTauri } from "@/native/backend";
import { Titlebar } from "./Titlebar";
import { Console } from "./Console";
import { DevicePicker } from "./DevicePicker";
import { FlowPicker } from "./FlowPicker";
import { FlowView } from "./FlowView";

function WizardBody() {
  const { phase } = useWizard();
  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        {phase === "pick-device" && <DevicePicker />}
        {phase === "pick-flow" && <FlowPicker />}
        {phase === "in-flow" && <FlowView />}
      </section>
      <Console />
    </div>
  );
}

export function AppWindow() {
  // Native: fill the real OS window, no fake chrome.
  if (isTauri()) {
    return (
      <div className="flex h-screen w-full flex-col bg-background">
        <WizardBody />
      </div>
    );
  }

  // Web: float the app window on a dotted backdrop, capped + framed.
  return (
    <div className="backdrop-dots flex min-h-screen w-full items-center justify-center p-4 sm:p-8">
      <div className="flex h-[min(82vh,760px)] w-full max-w-[1120px] flex-col overflow-hidden rounded-[12px] border border-[#d4cdc1] bg-background shadow-window">
        <Titlebar />
        <WizardBody />
      </div>
    </div>
  );
}
