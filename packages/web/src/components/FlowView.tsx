// SPDX-License-Identifier: GPL-2.0-or-later

// Screen 3: the guided step frame — flush-left step rail, white content region,
// footer bar pinned to the bottom (the "Sphinx docs" layout from the notes).
import { useWizard } from "@/lib/wizard";
import { StepRail } from "./StepRail";
import { StepContent } from "./StepContent";
import { Footer } from "./Footer";

export function FlowView() {
  const { flow } = useWizard();
  if (!flow) return null;
  return (
    <div className="flex min-h-0 flex-1">
      <StepRail />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <StepContent />
        </div>
        <Footer />
      </div>
    </div>
  );
}
