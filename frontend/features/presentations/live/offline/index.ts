// Offline answer queue (W2-D phase 2): answers the live path could not deliver
// are kept in IndexedDB, keyed by `clientAnswerId`, and sent again with backoff
// until the server accepts or refuses them. The live store wires it in
// (`submitAnswer`, `startAnswerSync`); docs: frontend/docs/wiki/features/live-surfaces.md.
export type { AnswerQueueStorage, QueuedAnswer } from "./types";
export {
  ANSWER_DB_NAME,
  ANSWER_STORE,
  createIndexedDbAnswerStorage,
  createMemoryAnswerStorage,
  defaultAnswerQueueStorage,
  withMemoryFallback,
} from "./storage";
export {
  createAnswerSync,
  queueRetryDelayMs,
  QUEUE_MAX_AGE_MS,
  QUEUE_RETRY_DELAYS_MS,
  type AnswerSync,
  type AnswerSyncOptions,
  type SettledDelivery,
} from "./sync";
