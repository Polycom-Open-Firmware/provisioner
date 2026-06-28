// @provisioner/core — transport-agnostic provisioning engine. A UI shell injects
// a Backend (web: WebUSB/Serial; native: Tauri → Rust) and an Artifacts source,
// constructs a WizardRunner, and drives a device profile's flows. No file in this
// package imports a platform USB binding.

// The seam
export * from "./transport/transport";

// Protocols
export { Fastboot, FASTBOOT_FILTERS, FASTBOOT_INTERFACE } from "./protocol/fastboot";
export type { InfoCb, ProgressCb } from "./protocol/fastboot";
export { parseSparse, planResparse, flashSparse } from "./protocol/sparse";
export { UBootConsole, PROMPT } from "./protocol/uboot-console";

// Engine
export * from "./engine/types";
export { Emitter, defer } from "./engine/emitter";
export type { EngineEvent, Listener, Deferred } from "./engine/emitter";
export { WizardRunner } from "./engine/runner";
export type { RunnerOptions } from "./engine/runner";

// Flows
export { unlockFlow } from "./flow/unlock";
export { reinstallLinuxFlow } from "./flow/reinstall-linux";

// Profiles
export {
  tc8Profile,
  TC8_FILTERS,
  STAGE2_LOCATION,
  STOCK_PARTITIONS,
  ENV,
} from "./profiles/tc8";
