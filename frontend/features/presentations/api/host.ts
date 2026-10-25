import { apiClient } from "@/lib/api-client";
import type { HostCommandResponse, HostState } from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

// Host session controls (policy `deck:host`). Every command answers with the
// deck plus the session it acted on (`HostCommandResponse`); contract:
// backend/docs/wiki/modules/presentations-live.md.

/** The live session, else the latest ended one, else `session: null`; never opens anything. */
export const getHostState = async (id: string) =>
  (await apiClient.get<ApiOk<HostState>>(`/presentations/${id}/host/state`)).data.data;

const command = async (id: string, name: string, body?: unknown) =>
  (await apiClient.post<ApiOk<HostCommandResponse>>(`/presentations/${id}/host/${name}`, body)).data.data;

/** Ends the live session if any (keeping its data) and opens a new session in the lobby. */
export const openLobby = (id: string) => command(id, "open-lobby");

/** Presents without a lobby: the lobby session (or a new one) goes to slide 0. 409 SESSION_ALREADY_LIVE while active. */
export const startSession = (id: string) => command(id, "start");

/** Any slide, forwards or backwards; revisits come back in their stored phase. */
export const gotoSlide = (id: string, slideIndex: number) => command(id, "goto", { slideIndex });

/** Stops answers on the current response slide without revealing. */
export const closeVoting = (id: string) => command(id, "close");

/** Re-opens the current closed/revealed response slide with a fresh timer. */
export const reopenVoting = (id: string) => command(id, "reopen");

/** Closes (if open) and reveals the current response slide's results. */
export const revealResults = (id: string) => command(id, "reveal");

export const endSession = (id: string) => command(id, "end");
