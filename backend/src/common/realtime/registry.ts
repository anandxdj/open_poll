import type { Server, Socket } from 'socket.io';

export type ChannelHandler = (message: string, io: Server) => void;

export interface SocketModule {
  /** Unique module name, used in logs. */
  name: string;
  /** Attaches the module's client event handlers to every new connection. */
  onConnection?: (socket: Socket, io: Server) => void;
  /**
   * Redis pub/sub channels the module consumes. Every instance subscribes, so a
   * handler must deliver with `io.local` — `io.to` would re-broadcast through a
   * cluster adapter and duplicate events.
   */
  channels?: Record<string, ChannelHandler>;
}

const modules = new Map<string, SocketModule>();

/** Registers a module's socket surface. Called once per module, from `modules.ts`. */
export const registerSocketModule = (module: SocketModule): SocketModule => {
  if (modules.has(module.name)) {
    throw new Error(`[Realtime] Socket module "${module.name}" is registered twice`);
  }
  modules.set(module.name, module);
  return module;
};

export const getSocketModules = (): SocketModule[] => [...modules.values()];
