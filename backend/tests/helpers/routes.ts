/**
 * Route-table introspection for Express 5.
 *
 * Router 2.x compiles a mount path into a matcher and throws the string away,
 * so `app.use('/api/auth', authRouter)` leaves no trace of `/api/auth` on the
 * stack. Importing this module wraps `Router.prototype.use` to tag each new
 * layer with the path it was mounted at. Import it before the app is built.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Router } from 'express';

const MOUNT_PATH = Symbol.for('openpoll.test.mountPath');

type Layer = {
  name: string;
  handle: unknown;
  route?: { path: unknown; methods: Record<string, boolean> };
  [MOUNT_PATH]?: unknown;
};

const routerProto = Router.prototype as unknown as {
  use: (this: { stack: Layer[] }, ...args: unknown[]) => unknown;
  __openpollRecorded?: boolean;
};

if (!routerProto.__openpollRecorded) {
  const originalUse = routerProto.use;
  routerProto.use = function recordedUse(...args) {
    const before = this.stack.length;
    const result = originalUse.apply(this, args);
    // Same disambiguation as Router#use: a leading non-function argument is the path.
    let path: unknown = '/';
    let first = args[0];
    while (Array.isArray(first) && first.length > 0) first = first[0];
    if (typeof first !== 'function') path = args[0];
    for (const layer of this.stack.slice(before)) layer[MOUNT_PATH] = path;
    return result;
  };
  routerProto.__openpollRecorded = true;
}

const formatPath = (path: unknown): string => {
  if (Array.isArray(path)) return `[${path.map(formatPath).join(',')}]`;
  return String(path);
};

const joinPath = (prefix: string, path: string): string => {
  if (path === '/') return prefix || '/';
  return `${prefix}${path}`;
};

const isRouter = (handle: unknown): handle is { stack: Layer[] } =>
  typeof handle === 'function' && Array.isArray((handle as { stack?: unknown }).stack);

function walk(stack: Layer[], prefix: string, lines: string[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const path = joinPath(prefix, formatPath(layer.route.path));
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) lines.push(`${method === '_all' ? 'ALL' : method.toUpperCase()} ${path}`);
      }
      continue;
    }
    const path = joinPath(prefix, formatPath(layer[MOUNT_PATH] ?? '/'));
    if (isRouter(layer.handle)) {
      lines.push(`ROUTER ${path}`);
      walk(layer.handle.stack, path, lines);
    } else {
      lines.push(`USE ${path} ${layer.name}`);
    }
  }
}

/**
 * Every layer of the app in registration order: `USE <path> <fn name>` for
 * middleware, `ROUTER <path>` for a mounted router (empty stubs included) and
 * `<METHOD> <full path>` for each route.
 */
export function listRoutes(app: { router: { stack: unknown[] } }): string[] {
  const lines: string[] = [];
  walk(app.router.stack as Layer[], '', lines);
  return lines;
}

export const ROUTE_SNAPSHOT_PATH = new URL('../http.routes.snapshot.txt', import.meta.url).pathname;

export function readRouteSnapshot(): string[] {
  return readFileSync(ROUTE_SNAPSHOT_PATH, 'utf8').split('\n').filter(Boolean);
}

export function writeRouteSnapshot(lines: string[]): void {
  writeFileSync(ROUTE_SNAPSHOT_PATH, `${lines.join('\n')}\n`);
}
