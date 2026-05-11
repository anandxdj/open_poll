import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false, // We will connect it manually when the user opens the analytics dashboard
      transports: ['websocket'], // Force WebSockets instead of long-polling for speed
    });
  }
  return socket;
};