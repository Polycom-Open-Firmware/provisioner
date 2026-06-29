// SPDX-License-Identifier: GPL-2.0-or-later

// emitter.ts — a tiny typed event emitter. The wizard UI subscribes to these
// events to render progress, the console pane, and step transitions; nothing in
// the UI reaches into the runner's internals.

/** Events the runner emits across the whole flow. */
export type EngineEvent =
  | { type: "flow:start"; flowId: string; steps: number }
  | { type: "step:enter"; index: number; stepId: string }
  | { type: "action:start"; index: number }
  | { type: "action:done"; index: number }
  | { type: "running"; running: boolean } // drives the console's live dot
  | { type: "console"; ts: number; msg: string }
  | { type: "progress"; done: number; total: number }
  | { type: "error"; index: number; message: string }
  | { type: "flow:done"; flowId: string };

export type Listener = (e: EngineEvent) => void;

export class Emitter {
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
