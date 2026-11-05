import { apiClient } from "@/lib/api-client";
import type { HostCommandResponse, HostState, KickResponse, RemoteStatus, RemoteTokenCreated } from "../types";

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

// ---------- Audience pace (W2-F) ----------

/**
 * Opens every response slide of an audience-paced deck at once (from the
 * lobby, or a new session). `closesAt`: an ISO time, null for no closing time;
 * omitted takes the deck's default duration. On an open session it changes the
 * closing time; on a closed one it opens the slides again.
 */
export const openAudience = (id: string, closesAt?: string | null) =>
  command(id, "open-audience", closesAt === undefined ? {} : { closesAt });

/** Stops answers on every slide; results shown "after close" appear on the phones. */
export const closeAudience = (id: string) => command(id, "close-audience");

// ---------- Presenter tools (W2-A) ----------

/** Pauses, resumes or extends (by `seconds`, 5–600, default 30) the current slide's timer. */
export const timerCommand = (id: string, action: "pause" | "resume" | "extend", seconds?: number) =>
  command(id, "timer", seconds === undefined ? { action } : { action, seconds });

/** Time's up now on the current slide (its grace and auto-reveal follow). */
export const skipTimer = (id: string) => command(id, "skip");

/** Removes a participant from the live session: no answers, no rejoin. */
export const kickParticipant = async (id: string, participantId: string) =>
  (await apiClient.post<ApiOk<KickResponse>>(`/presentations/${id}/host/participants/${participantId}/kick`)).data.data;

export const getRemoteStatus = async (id: string) =>
  (await apiClient.get<ApiOk<RemoteStatus>>(`/presentations/${id}/host/remote-token`)).data.data;

/** A new phone-remote pairing (the previous one is revoked). The token is returned once. */
export const createRemoteToken = async (id: string) =>
  (await apiClient.post<ApiOk<RemoteTokenCreated>>(`/presentations/${id}/host/remote-token`)).data.data;

export const revokeRemoteToken = async (id: string) =>
  (await apiClient.delete<ApiOk<RemoteStatus>>(`/presentations/${id}/host/remote-token`)).data.data;
