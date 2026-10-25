import type { NextRequest } from "next/server";

/**
 * One step of the request proxy chain. Return a response (redirect, rewrite,
 * direct reply) to stop the chain there, or nothing to hand the request to
 * the next step.
 */
export type ProxyStep = (request: NextRequest) => Response | undefined | Promise<Response | undefined>;
