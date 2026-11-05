import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpScope } from './mcp.constants';
import type { McpUserContext } from './mcp.context';
import { handleMcpTool } from './mcp.tools';

/**
 * Resources mirror the read tools, for clients that attach context instead of
 * calling tools. Each one reads through `handleMcpTool`, so scopes, the pinned
 * workspace and the policy apply exactly as they do to the tool.
 */

const json = (uri: URL, value: unknown) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
});

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

export function registerMcpResources(server: McpServer, ctx: McpUserContext) {
  const allowed = (scope: McpScope) => ctx.scopes.includes(scope);

  if (allowed('deck:read')) {
    server.registerResource(
      'slide-types',
      'openpoll://slide-types',
      {
        title: 'Slide types',
        description: 'Every slide kind a deck can hold, with fields and an example',
        mimeType: 'application/json',
      },
      async (uri) => json(uri, await handleMcpTool('list_slide_types', {}, ctx)),
    );

    server.registerResource(
      'deck',
      new ResourceTemplate('openpoll://decks/{deckId}', {
        list: async () => {
          const { decks } = (await handleMcpTool('list_decks', { limit: 50 }, ctx)) as {
            decks: { id: string; title: string; status: string }[];
          };
          return {
            resources: decks.map((deck) => ({
              uri: `openpoll://decks/${deck.id}`,
              name: deck.title,
              description: `Deck (${deck.status})`,
              mimeType: 'application/json',
            })),
          };
        },
      }),
      { title: 'Deck', description: 'A deck with its slides, theme and links', mimeType: 'application/json' },
      async (uri, variables) => json(uri, await handleMcpTool('get_deck', { deckId: one(variables.deckId) }, ctx)),
    );
  }

  if (allowed('results:read')) {
    server.registerResource(
      'session-results',
      new ResourceTemplate('openpoll://sessions/{sessionId}/results', { list: undefined }),
      {
        title: 'Session results',
        description: 'Per-slide results, participation and leaderboard top 10 of one session',
        mimeType: 'application/json',
      },
      async (uri, variables) =>
        json(uri, await handleMcpTool('get_session_results', { sessionId: one(variables.sessionId) }, ctx)),
    );

    server.registerResource(
      'insights',
      'openpoll://insights',
      {
        title: 'Workspace insights',
        description: 'Activity of the last 30 days: sessions, people, responses, top decks',
        mimeType: 'application/json',
      },
      async (uri) => json(uri, await handleMcpTool('get_insights', {}, ctx)),
    );
  }
}
