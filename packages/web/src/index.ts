// @provisioner/web — the web flavor's platform adapter: WebUSB + Web Serial
// transports, an HTTP artifact source, and the Backend factory the UI injects
// into core's WizardRunner. (React/shadcn UI lands on top of this next.)
export { WebUsbTransport } from "./usb";
export { WebSerialTransport } from "./serial";
export { HttpArtifacts } from "./artifacts";
export { WebBackend, webBackend, webSupport } from "./backend";
