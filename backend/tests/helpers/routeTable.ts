/**
 * Structured route-table introspection for the tenancy isolation test: for
 * every route, its method, full path and the workspace-context middleware it
 * runs (the ones marked by `workspaceContext()` / `pathWorkspaceContext()`).
 *
 * Builds on ./routes, which tags each mount with its path. Import this module
 * before createApp() runs.
 */
import './routes';
import { WORKSPACE_CONTEXT_MARK, type WorkspaceContextKind } from '../../src/common/tenancy/workspaceContext.middleware';

const MOUNT_PATH = Symbol.for('openpoll.test.mountPath');

type Layer = {
  handle: unknown;
  route?: { path: unknown; methods: Record<string, boolean>; stack: Layer[] };
  [MOUNT_PATH]?: unknown;
};

export interface RouteInfo {
  method: string;
  /** Full path as mounted, e.g. `/api/presentations/:id/host/start`. */
  path: string;
  /** Workspace-context middlewares that run before the handler (route-level or router-level). */
  contexts: WorkspaceContextKind[];
}

const isRouter = (handle: unknown): handle is { stack: Layer[] } =>
  typeof handle === 'function' && Array.isArray((handle as { stack?: unknown }).stack);

const format = (path: unknown): string => (Array.isArray(path) ? path.map(format).join(',') : String(path));

const join = (prefix: string, path: string) => (path === '/' ? prefix || '/' : `${prefix}${path}`);

const markOf = (handle: unknown): WorkspaceContextKind | null =>
  typeof handle === 'function'
    ? ((handle as unknown as Record<symbol, WorkspaceContextKind | undefined>)[WORKSPACE_CONTEXT_MARK] ?? null)
    : null;

function walk(stack: Layer[], prefix: string, inherited: WorkspaceContextKind[], out: RouteInfo[]): void {
  // Middleware mounted at the router's root (`router.use(workspaceContext())`) guards every route after it.
  const local: WorkspaceContextKind[] = [];
  for (const layer of stack) {
    if (layer.route) {
      const own = layer.route.stack.map((handler) => markOf(handler.handle)).filter((kind) => kind !== null);
      const path = join(prefix, format(layer.route.path));
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) {
          out.push({ method: method === '_all' ? 'ALL' : method.toUpperCase(), path, contexts: [...inherited, ...local, ...own] });
        }
      }
      continue;
    }
    const mount = format(layer[MOUNT_PATH] ?? '/');
    if (isRouter(layer.handle)) {
      walk(layer.handle.stack, join(prefix, mount), [...inherited, ...local], out);
    } else {
      const kind = markOf(layer.handle);
      if (kind && mount === '/') local.push(kind);
    }
  }
}

export function listRouteInfo(app: { router: { stack: unknown[] } }): RouteInfo[] {
  const out: RouteInfo[] = [];
  walk(app.router.stack as Layer[], '', [], out);
  return out;
}
