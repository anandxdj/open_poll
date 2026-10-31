import { describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/modules/mcp/mcp.server';
import { MCP_POLL_ONLY_SCOPES, MCP_SCOPES, type McpScope } from '../src/modules/mcp/mcp.constants';
import { MCP_TOOL_SCOPES } from '../src/modules/mcp/mcp.tools';

/**
 * What an agent reads in tools/list, prompts/list and resources/templates/list,
 * through a real client over an in-memory transport. Listing touches no
 * database: tools are registered from the table, so this runs offline.
 */
async function listed(scopes: readonly McpScope[]) {
  const server = createMcpServer({ userId: 'u1', tokenId: 't1', scopes: [...scopes] });
  const client = new Client({ name: 'schema-test', version: '1.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  // A server with no prompts or resources does not declare the capability at all.
  const capabilities = client.getServerCapabilities() ?? {};
  const [{ tools }, { prompts }, { resourceTemplates }] = await Promise.all([
    client.listTools(),
    capabilities.prompts ? client.listPrompts() : { prompts: [] },
    capabilities.resources ? client.listResourceTemplates() : { resourceTemplates: [] },
  ]);
  await client.close();
  return { tools, prompts, resourceTemplates };
}

describe('MCP tools/list', () => {
  it('emits an object input schema for every tool, with the required fields agents must send', async () => {
    const { tools } = await listed(MCP_SCOPES);
    const summary = Object.fromEntries(
      tools.map((tool) => [tool.name, { scope: MCP_TOOL_SCOPES[tool.name], required: tool.inputSchema.required ?? [] }]),
    );
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
    expect(summary).toMatchSnapshot();
  });

  it('lists every tool of the table to a token with every scope', async () => {
    const { tools } = await listed(MCP_SCOPES);
    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(MCP_TOOL_SCOPES).sort());
  });

  it('shows a poll-only token its poll tools and get_context, nothing else', async () => {
    const { tools, prompts, resourceTemplates } = await listed(MCP_POLL_ONLY_SCOPES);
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('create_poll');
    expect(names).toContain('get_context');
    expect(names).not.toContain('create_deck');
    expect(names).not.toContain('open_lobby');
    expect(prompts).toEqual([]);
    expect(resourceTemplates).toEqual([]);
  });

  it('marks the commands that end or replace a session as destructive', async () => {
    const { tools } = await listed(MCP_SCOPES);
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint).map((tool) => tool.name);
    expect(destructive.sort()).toEqual(['end_session', 'open_lobby', 'remove_slides']);
  });

  it('describes every slide kind inside create_deck', async () => {
    const { tools } = await listed(MCP_SCOPES);
    const createDeck = tools.find((tool) => tool.name === 'create_deck')!;
    const slides = (createDeck.inputSchema.properties as any).slides;
    const variants = slides.items.oneOf ?? slides.items.anyOf;
    const kinds = variants.map((variant: any) => variant.properties.kind.const);
    expect(kinds).toContain('grid_2x2');
    expect(kinds).toContain('multiple_choice_quiz');
    const quiz = variants.find((variant: any) => variant.properties.kind.const === 'multiple_choice_quiz');
    expect(quiz.required).toEqual(['kind', 'question', 'options']);
  });
});

describe('MCP prompts and resources', () => {
  it('offers the prompts and resource templates a full token can use', async () => {
    const { prompts, resourceTemplates } = await listed(MCP_SCOPES);
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(['quiz_from_document', 'run_retro', 'summarize_session']);
    expect(resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
      'openpoll://decks/{deckId}',
      'openpoll://sessions/{sessionId}/results',
    ]);
  });
});
