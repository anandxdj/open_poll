"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acquireSocket, releaseSocket } from "@/lib/socket";
import { getApiErrorStatus } from "@/lib/api-error";
import { getApiErrorCode } from "@/features/presentations/live/errors";
import {
  LIVE_SOCKET_EVENTS,
  type PresentationRealtimeEvent,
  type RemoteCommand,
  type RemoteCommandAck,
  type RemoteJoinAck,
  type RemoteState,
} from "@/features/presentations/types";
import { getRemoteState, remoteDeviceKey } from "./api";

/**
 * Where the remote stands: connecting, live (joined over the socket),
 * reconnecting (socket down, last state on screen), or a final refusal —
 * `invalid` (unpaired, replaced or expired), `bound` (another phone has it),
 * `revoked` (the presenter unpaired it while open), `failed` (unreachable).
 */
export type RemoteLink = "connecting" | "live" | "reconnecting" | "invalid" | "bound" | "revoked" | "failed";

export type CommandOutcome = { ok: true } | { ok: false; message: string; error: string };

/** Events after which the remote re-reads its state (slide changes, phases, timing, the session). */
const REFRESH_ON = new Set([
  "session:lobby",
  "question:started",
  "slide:shown",
  "slide:closed",
  "question:revealed",
  "leaderboard:shown",
  "session:ended",
  "slide:timing",
]);

const ACK_TIMEOUT_MS = 5_000;
const REFRESH_DEBOUNCE_MS = 250;
/** Answer counts and joins are not events the remote hears: in the lobby and while voting is open it re-reads them this often. */
const OPEN_POLL_MS = 3_000;

/**
 * The phone remote's driver (W2-A): joins with `remote:join {token, deviceKey}`
 * on every (re)connect, follows the deck's public events (re-reading the state
 * over REST, debounced), and sends commands with `remote:command` and an ack.
 * `serverOffsetMs` aligns countdowns with the server clock.
 */
export function useRemote(token: string) {
  const [link, setLink] = useState<RemoteLink>("connecting");
  const [state, setState] = useState<RemoteState | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [pending, setPending] = useState<RemoteCommand | null>(null);
  const socketRef = useRef<ReturnType<typeof acquireSocket> | null>(null);
  const finalRef = useRef(false);
  const stateRef = useRef<RemoteState | null>(null);

  const apply = useCallback((next: RemoteState, receivedAt = Date.now()) => {
    stateRef.current = next;
    setState(next);
    const serverMs = Date.parse(next.serverNow);
    if (!Number.isNaN(serverMs)) setServerOffsetMs(serverMs - receivedAt);
  }, []);

  const fail = useCallback((reason: RemoteLink) => {
    finalRef.current = true;
    setLink(reason);
  }, []);

  useEffect(() => {
    const deviceKey = remoteDeviceKey();
    const socket = acquireSocket();
    socketRef.current = socket;
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        getRemoteState(token, deviceKey)
          .then((next) => {
            if (!disposed) apply(next);
          })
          .catch((err: unknown) => {
            if (disposed) return;
            const code = getApiErrorCode(err);
            if (code === "REMOTE_BOUND") fail("bound");
            else if (code === "REMOTE_INVALID" || getApiErrorStatus(err) === 404) fail("invalid");
          });
      }, REFRESH_DEBOUNCE_MS);
    };

    const join = () => {
      if (disposed || finalRef.current || !socket.connected) return;
      socket.timeout(ACK_TIMEOUT_MS).emit(LIVE_SOCKET_EVENTS.remoteJoin, { token, deviceKey }, (err: Error | null, ack?: RemoteJoinAck) => {
        if (disposed || finalRef.current) return;
        if (err || !ack) {
          setLink("reconnecting");
          return;
        }
        if (ack.ok) {
          apply(ack.state);
          setLink("live");
        } else if (ack.error === "REMOTE_BOUND") fail("bound");
        else if (ack.error === "REMOTE_INVALID" || ack.error === "INVALID_PAYLOAD") fail("invalid");
        else setLink("failed");
      });
    };

    const onConnect = () => join();
    const onDisconnect = () => {
      if (!finalRef.current) setLink("reconnecting");
    };
    const onEvent = (event: PresentationRealtimeEvent) => {
      if (!finalRef.current && REFRESH_ON.has(event.type)) refresh();
    };
    const onRevoked = () => fail("revoked");
    const onVisible = () => {
      if (document.visibilityState === "visible" && !finalRef.current) refresh();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    socket.on(LIVE_SOCKET_EVENTS.event, onEvent);
    socket.on(LIVE_SOCKET_EVENTS.remoteRevoked, onRevoked);
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => {
      const current = stateRef.current;
      if (finalRef.current || !socket.connected || !current) return;
      if (current.status === "lobby" || current.slide?.phase === "open") refresh();
    }, OPEN_POLL_MS);
    join();

    return () => {
      disposed = true;
      clearInterval(poll);
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", onVisible);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
      socket.off(LIVE_SOCKET_EVENTS.event, onEvent);
      socket.off(LIVE_SOCKET_EVENTS.remoteRevoked, onRevoked);
      socketRef.current = null;
      releaseSocket();
    };
  }, [token, apply, fail]);

  /** Sends one command; resolves with the outcome (the new state is applied on success). */
  const send = useCallback(
    (command: RemoteCommand) =>
      new Promise<CommandOutcome>((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ ok: false, error: "UNAVAILABLE", message: "" });
          return;
        }
        setPending(command);
        socket.timeout(ACK_TIMEOUT_MS).emit(LIVE_SOCKET_EVENTS.remoteCommand, { command }, (err: Error | null, ack?: RemoteCommandAck) => {
          setPending(null);
          if (err || !ack) {
            resolve({ ok: false, error: "UNAVAILABLE", message: "" });
            return;
          }
          if (ack.ok) {
            apply(ack.state);
            resolve({ ok: true });
            return;
          }
          if (ack.error === "REMOTE_INVALID") fail("invalid");
          resolve({ ok: false, error: ack.error, message: ack.message ?? "" });
        });
      }),
    [apply, fail]
  );

  return { link, state, serverOffsetMs, pending, send };
}
