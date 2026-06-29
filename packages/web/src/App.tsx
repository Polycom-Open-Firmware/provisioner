// SPDX-License-Identifier: GPL-2.0-or-later

import { WizardProvider } from "@/lib/wizard";
import { AppWindow } from "@/components/AppWindow";

export default function App() {
  return (
    <WizardProvider>
      <AppWindow />
    </WizardProvider>
  );
}
