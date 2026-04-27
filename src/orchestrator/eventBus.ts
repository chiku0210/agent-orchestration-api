import { EventEmitter } from "node:events";

export type PublishedEvent = {
  runId: string;
  event: unknown;
};

export const runEventBus = new EventEmitter();

export function publishRunEvent(runId: string, event: unknown) {
  runEventBus.emit(runId, { runId, event } satisfies PublishedEvent);
}

