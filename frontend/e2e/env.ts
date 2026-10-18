import { existsSync } from "node:fs";
import path from "node:path";

/**
 * One place for every knob the e2e suite reads. Defaults target the dedicated
 * test containers (Mongo :27117, Redis :6390) — never the dev ones on
 * 27017/6379 — and ports no dev server uses, so a run never touches dev data.
 */
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 3103);
const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 5103);

export const e2eEnv = {
  frontendPort,
  backendPort,
  frontendUrl: process.env.E2E_FRONTEND_URL ?? `http://localhost:${frontendPort}`,
  apiOrigin: process.env.E2E_API_URL ?? `http://localhost:${backendPort}`,
  mongoUri:
    process.env.E2E_MONGO_URI ?? "mongodb://127.0.0.1:27117/openpoll_w0c1?directConnection=true",
  redisUrl: process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6390/3",
  hostEmail: process.env.E2E_HOST_EMAIL ?? "e2e-host@openpoll.test",
  hostPassword: process.env.E2E_HOST_PASSWORD ?? "E2eHost!2345",
  /** System Chromium when present, so a run never has to download a browser. */
  chromiumPath:
    process.env.E2E_CHROMIUM_PATH ??
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  backendDir: path.resolve(__dirname, "../../backend"),
};
