import { Router, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuth, type McpAuthRequest } from './mcp.auth';
import { mcpRateLimit } from './mcp.rateLimit';
import { createMcpServer } from './mcp.server';

const router = Router();

/**
 * Stateless Streamable HTTP: every POST gets its own server and transport,
 * built from the bearer token on that request. Nothing is kept between
 * requests, so any backend instance can answer any call, and a token's scopes
 * and pinned workspace are never older than the request. Clients that still
 * send an Mcp-Session-Id header are served the same way (stateless transports
 * do not check it).
 */
async function handleMcpRequest(req: McpAuthRequest, res: Response) {
  if (!req.mcp) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const server = createMcpServer({
    userId: req.mcp.user.id,
    tokenId: req.mcp.tokenId,
    scopes: req.mcp.scopes,
    workspaceId: req.mcp.workspaceId,
    kind: req.mcp.kind,
    clientId: req.mcp.clientId,
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[MCP] Request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

/** No server-initiated stream and no session to delete in stateless mode. */
function methodNotAllowed(_req: McpAuthRequest, res: Response) {
  res.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: this server is stateless, use POST' },
    id: null,
  });
}

router.post('/', mcpAuth, mcpRateLimit, handleMcpRequest);
router.get('/', mcpAuth, methodNotAllowed);
router.delete('/', mcpAuth, methodNotAllowed);

export default router;
