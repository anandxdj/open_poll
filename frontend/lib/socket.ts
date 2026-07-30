import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL;
if (!SOCKET_URL && typeof window !== 'undefined') {
  console.warn('[socket] NEXT_PUBLIC_SOCKET_URL not set — falling back to http://localhost:5000');
}

let socket: Socket | null = null;
let consumers = 0;

const createSocket = () =>
  io(SOCKET_URL || 'http://localhost:5000', {
    autoConnect: false,
    transports: ['websocket', 'polling'],
  });

export const getSocket = (): Socket => {
  if (!socket) socket = createSocket();
  return socket;
};

/** Increment refcount and connect. Pair every call with releaseSocket(). */
export const acquireSocket = (): Socket => {
  if (!socket) socket = createSocket();
  consumers++;
  if (!socket.connected) socket.connect();
  return socket;
};

/** Decrement refcount; disconnects when no consumers remain. */
export const releaseSocket = (): void => {
  consumers = Math.max(0, consumers - 1);
  if (consumers === 0) socket?.disconnect();
};
