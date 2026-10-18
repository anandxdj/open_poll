import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { e2eEnv } from "./env";

type ApiOk<T> = { success: boolean; message: string; data: T };

export interface DeckSlideInput {
  type: string;
  question: string;
  timeLimit?: number;
  [field: string]: unknown;
}

export interface CreatedDeck {
  _id: string;
  joinCode: string;
  title: string;
}

export interface Host {
  accessToken: string;
  createDeck(title: string, slides: DeckSlideInput[]): Promise<CreatedDeck>;
  /** Opens a page signed in as the host (token seeded into the persisted auth store). */
  open(path: string): Promise<Page>;
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

/** Joins `/live/<code>` with a nickname in a fresh browser context. */
export async function joinAsParticipant(
  browser: Browser,
  contexts: BrowserContext[],
  joinCode: string,
  name: string
): Promise<Participant> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/live/${joinCode}`);
  await page.getByPlaceholder("Your nickname").fill(name);
  await page.getByRole("button", { name: "Join Session" }).click();
  await expect(page.getByRole("heading", { name: "You're in!" })).toBeVisible();
  return { name, page };
}

export const test = base.extend<{ host: Host; contexts: BrowserContext[] }>({
  // Every context opened through the fixtures is closed after the test.
  // (`provide` is Playwright's `use`, renamed so the React hooks lint rule
  // does not mistake it for React's `use`.)
  contexts: async ({}, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(contexts);
    await Promise.all(contexts.map((c) => c.close()));
  },

  host: async ({ browser, contexts }, provide) => {
    const { user, accessToken } = await api<{ user: Record<string, unknown>; accessToken: string }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email: e2eEnv.hostEmail, password: e2eEnv.hostPassword }),
      }
    );

    const host: Host = {
      accessToken,
      createDeck: (title, slides) =>
        api<CreatedDeck>("/presentations", {
          method: "POST",
          token: accessToken,
          body: JSON.stringify({ title, slides }),
        }),
      open: async (path) => {
        const context = await browser.newContext();
        contexts.push(context);
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
        const page = await context.newPage();
        // The end-session button asks for confirmation.
        page.on("dialog", (dialog) => void dialog.accept());
        await page.goto(path);
        return page;
      },
    };
    await provide(host);
  },
});

export { expect };
