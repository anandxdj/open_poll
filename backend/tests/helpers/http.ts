/** Minimal Express req/res doubles for calling controllers and middleware directly. */

export interface MockRes {
  statusCode?: number;
  body?: any;
  redirects: string[];
  cookies: Record<string, { value: string; options: any }>;
  cleared: string[];
  status(code: number): MockRes;
  json(body: any): MockRes;
  redirect(url: string): MockRes;
  cookie(name: string, value: string, options: any): MockRes;
  clearCookie(name: string, options?: any): MockRes;
}

export function mockRes(): MockRes {
  const res: MockRes = {
    redirects: [],
    cookies: {},
    cleared: [],
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    redirect(url) {
      res.redirects.push(url);
      return res;
    },
    cookie(name, value, options) {
      res.cookies[name] = { value, options };
      return res;
    },
    clearCookie(name) {
      res.cleared.push(name);
      return res;
    },
  };
  return res;
}

export function mockReq(init: {
  query?: Record<string, unknown>;
  body?: any;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  ip?: string;
  params?: Record<string, string>;
} = {}): any {
  const headers = Object.fromEntries(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    query: init.query ?? {},
    body: init.body ?? {},
    cookies: init.cookies ?? {},
    params: init.params ?? {},
    headers,
    ip: init.ip ?? '203.0.113.7',
    socket: {},
    get: (name: string) => headers[name.toLowerCase()],
  };
}

/** Captures what a middleware passed to next(). */
export function captureNext() {
  const calls: unknown[] = [];
  const next = (err?: unknown) => {
    calls.push(err);
  };
  return { next: next as any, calls };
}
