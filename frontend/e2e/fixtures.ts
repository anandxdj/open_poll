import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { e2eEnv } from "./env";

type ApiOk<T> = { success: boolean; message: string; data: T };

export interface DeckSlideInput {
  type: string;
  /** Required by the question types; content slides carry `content` instead. */
  question?: string;
  timeLimit?: number;
  [field: string]: unknown;
}

export interface CreatedDeck {
  _id: string;
  joinCode: string;
  title: string;
}

export interface SessionSummary {
  sessionId: string;
  runNumber: number;
  status: "lobby" | "active" | "ended";
  isLive: boolean;
  participantCount: number;
  answerCount: number;
}

export interface Host {
  accessToken: string;
  /** `extra` adds other create fields, e.g. `{ pace: "audience", theme: { mode: "dark" } }`. */
  createDeck(title: string, slides: DeckSlideInput[], extra?: Record<string, unknown>): Promise<CreatedDeck>;
  /** The deck as the API stores it (slides with answer keys and settings). */
  getDeck(id: string): Promise<CreatedDeck & { slides: Record<string, unknown>[] }>;
  /** Every run of the deck, newest first (`GET /:id/sessions`). */
  getSessions(id: string): Promise<SessionSummary[]>;
  /** HTTP status of the public code lookup (404 until a session was opened). */
  lookupCodeStatus(joinCode: string): Promise<number>;
  /**
   * Opens a page signed in as the host (token seeded into the persisted auth store).
   * `options` override the project's context options, e.g. a desktop host in a phone-sized spec.
   */
  open(path: string, options?: BrowserContextOptions): Promise<Page>;
}

export interface Participant {
  name: string;
  page: Page;
}

const api = async <T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> => {
  const res = await fetch(`${e2eEnv.apiOrigin}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
  });
  const body = (await res.json().catch(() => null)) as ApiOk<T> | null;
  if (!res.ok || !body) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.data;
};

/** Opens `/live/<code>` in a fresh browser context and submits the nickname form. */
async function submitNickname(browser: Browser, contexts: BrowserContext[], joinCode: string, name: string) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/live/${joinCode}`);
  await page.getByPlaceholder("Your nickname").fill(name);
  await page.getByRole("button", { name: "Join Session" }).click();
  return page;
}

/** Joins a lobby: `/live/<code>` with a nickname in a fresh browser context. */
export async function joinAsParticipant(
  browser: Browser,
  contexts: BrowserContext[],
  joinCode: string,
  name: string
): Promise<Participant> {
  const page = await submitNickname(browser, contexts, joinCode, name);
  await expect(page.getByRole("heading", { name: "You're in!" })).toBeVisible();
  return { name, page };
}

/** Joins a session that is already running; the caller asserts what the phone shows. */
export async function joinMidSession(
  browser: Browser,
  contexts: BrowserContext[],
  joinCode: string,
  name: string
): Promise<Participant> {
  return { name, page: await submitNickname(browser, contexts, joinCode, name) };
}

/** Host page: opens the lobby from the "ready to present" screen and waits for its join code. */
export async function openLobby(hostPage: Page, joinCode: string) {
  await hostPage.getByRole("button", { name: "Open lobby" }).click();
  await expect(hostPage.locator("main").getByText(joinCode, { exact: true })).toBeVisible();
}

/** Host page: End Session, then confirm in the app's dialog. */
export async function endSession(hostPage: Page) {
  await hostPage.getByRole("button", { name: "End Session" }).click();
  await hostPage.getByRole("alertdialog").getByRole("button", { name: "End session" }).click();
}

/**
 * Embedded browsers (in-app panes, webviews, sandboxed iframes) suppress
 * confirm()/alert()/prompt(), which then answer "no". Dismissing them here
 * makes any flow that still depends on one fail its spec instead of passing.
 */
export function dismissNativeDialogs(page: Page) {
  page.on("dialog", (dialog) => {
    console.warn(`[e2e] native ${dialog.type()} dismissed: ${dialog.message()}`);
    void dialog.dismiss();
  });
}

interface HostLogin {
  user: Record<string, unknown>;
  accessToken: string;
}

/**
 * Clicks the presenter view's "Open audience window" and opens the window it asks for as a second
 * tab of the same browser context (same BroadcastChannel as the real popup). window.open is
 * recorded, not followed: GitHub's headless Chromium crashes the renderer on this popup (CI only;
 * locally both Chromium builds are fine). Checks the URL and the popup features it was asked for.
 */
export async function openAudienceWindow(presenter: Page, presentationId: string): Promise<Page> {
  await presenter.evaluate(() => {
    const calls: Array<[string, string, string]> = [];
    (window as unknown as { __openCalls: typeof calls }).__openCalls = calls;
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      calls.push([String(url), String(target), String(features)]);
      return { closed: false, focus: () => {} } as unknown as Window;
    }) as typeof window.open;
  });
  await presenter.getByRole("button", { name: "Open audience window" }).click();
  const calls = await presenter.evaluate(
    () => (window as unknown as { __openCalls: Array<[string, string, string]> }).__openCalls,
  );
  expect(calls).toHaveLength(1);
  const [url, , features] = calls[0];
  expect(url).toContain(`/presentation/${presentationId}/present`);
  expect(features).toContain("popup");
  const audience = await presenter.context().newPage();
  await audience.goto(url);
  return audience;
}

export const test = base.extend<{ host: Host; contexts: BrowserContext[] }, { hostLogin: HostLogin }>({
  // One login per worker: the login endpoint allows 10 per 5 minutes per IP, and the
  // suite has more tests than that. (`provide` is Playwright's `use`, renamed so the
  // React hooks lint rule does not mistake it for React's `use`.)
  hostLogin: [
    async ({}, provide) => {
      const login = await api<HostLogin>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: e2eEnv.hostEmail, password: e2eEnv.hostPassword }),
      });
      await provide(login);
    },
    { scope: "worker" },
  ],

  // Every context opened through the fixtures is closed after the test.
  contexts: async ({}, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(contexts);
    await Promise.all(contexts.map((c) => c.close()));
  },

  host: async ({ browser, contexts, hostLogin }, provide) => {
    const { user, accessToken } = hostLogin;

    const host: Host = {
      accessToken,
      createDeck: (title, slides, extra = {}) =>
        api<CreatedDeck>("/presentations", {
          method: "POST",
          token: accessToken,
          body: JSON.stringify({ title, slides, ...extra }),
        }),
      getDeck: (id) => api(`/presentations/${id}`, { token: accessToken }),
      getSessions: (id) => api(`/presentations/${id}/sessions`, { token: accessToken }),
      lookupCodeStatus: async (joinCode) =>
        (await fetch(`${e2eEnv.apiOrigin}/api/presentations/code/${joinCode}`)).status,
      open: async (path, options) => {
        const context = await browser.newContext(options);
        contexts.push(context);
        // The proxy guards /polls, /settings, ... by this cookie before any script of the page
        // runs, so it is set on the context (the init script below only keeps it fresh).
        await context.addCookies([{ name: "auth_session", value: "1", url: e2eEnv.frontendUrl }]);
        // Same shape zustand's `persist` writes for useAuthStore ("auth-storage").
        await context.addInitScript(
          ({ user, accessToken }) => {
            window.localStorage.setItem(
              "auth-storage",
              JSON.stringify({ state: { user, accessToken }, version: 0 })
            );
            document.cookie = "auth_session=1; path=/; samesite=lax";
          },
          { user, accessToken }
        );
        // The Next dev overlay (its "N" / "1 Issue" badge) sits over the footer's first
        // button and swallows its clicks; the tests read the console through the app itself.
        await context.addInitScript(() => {
          const hideDevOverlay = () => {
            const style = document.createElement("style");
            style.textContent = "nextjs-portal { display: none !important; }";
            document.documentElement.appendChild(style);
          };
          hideDevOverlay();
        });
        const page = await context.newPage();
        dismissNativeDialogs(page);
        await page.goto(path);
        return page;
      },
    };
    await provide(host);
  },
});

export { expect };
