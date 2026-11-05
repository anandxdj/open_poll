import type { Socket } from 'socket.io';

/**
 * Screen tokens a socket joined with, by deck id (W4-D). The `screen` join
 * (`presentations.socket.ts`) records them; a revoked token's screens are
 * found by them (`embeds.socket.ts`).
 */
export const screenTokensOf = (socket: Socket): Map<string, string> => {
  const data = socket.data as { screenTokens?: Map<string, string> };
  if (!data.screenTokens) data.screenTokens = new Map();
  return data.screenTokens;
};
