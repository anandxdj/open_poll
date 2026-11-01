import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { isCredentialCall } from "@/lib/api-client";
import { authProxy, isProtectedRoute } from "@/lib/proxy/auth";

describe("token refresh scope", () => {
  test("a 401 from a credential endpoint is never treated as an expired session", () => {
    for (const url of ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/resend-verification", "/auth/logout"]) {
      expect(isCredentialCall(url), url).toBe(true);
    }
    for (const url of ["/auth/me", "/auth/me?x=1", "/library", "/presentations/abc", "/workspaces/abc/members", undefined]) {
      expect(isCredentialCall(url), String(url)).toBe(false);
    }
  });
});

describe("auth proxy step", () => {
  test("app pages are protected, participant and public pages are not", () => {
    for (const path of ["/home", "/polls", "/create", "/settings/profile", "/analytics", "/presentation/create", "/presentation/host/abc", "/presentations/abc/sessions"]) {
      expect(isProtectedRoute(path), path).toBe(true);
    }
    for (const path of ["/", "/login", "/signup", "/live", "/live/123456", "/p/abc", "/r/token", "/privacy", "/invites/token"]) {
      expect(isProtectedRoute(path), path).toBe(false);
    }
  });

  test("a signed-out visitor on the host console goes to /login", async () => {
    const response = await authProxy(new NextRequest("http://localhost:3000/presentation/host/abc"));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
