// SPDX-License-Identifier: GPL-2.0-or-later

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
export {
  Sdp,
  SDP_VID,
  SDP_PID_BOOTROM,
  SDP_PID_SPL,
  UBOOT_TEXT_BASE,
  findIvt,
  findFitMagic,
} from "./protocol/sdp";

// Engine
export * from "./engine/types";
export { Emitter, defer } from "./engine/emitter";
export type { EngineEvent, Listener, Deferred } from "./engine/emitter";
export { WizardRunner } from "./engine/runner";
export type { RunnerOptions } from "./engine/runner";

// Flows
export { unlockFlow } from "./flow/unlock";
export { reinstallLinuxFlow, osInstallSteps, setupSteps } from "./flow/reinstall-linux";
export { configureFlow } from "./flow/configure";
export {
  settingsSteps,
  DEVICE_SETTINGS,
  NETWORK_SETTINGS,
  ACCESS_SETTINGS,
  STANDARD_SETTINGS,
} from "./flow/settings";
export type { SettingsIntent, SettingsSection } from "./flow/settings";

// Config (the autoconfigure `cache` blob — see tc8-firmware-build/CONFIG-PARTITION.md)
export {
  buildConfigBlob,
  buildConfigBlobFromLines,
  configFieldsToLines,
  configStore,
  CONFIG_KEYS,
  CONFIG_MAGIC,
  CONFIG_PARTITION,
  CONFIG_MAX_PAYLOAD,
} from "./config/blob";
export type { ConfigKey, ConfigFields } from "./config/blob";

// Profiles
export {
  tc8Profile,
  TC8_FILTERS,
  STAGE2_LOCATION,
  STOCK_PARTITIONS,
  ENV,
} from "./profiles/tc8";
export { c60Profile, c60UnlockFlow, C60_FILTERS } from "./profiles/c60";
