import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { mcpAuth, type McpAuthRequest } from './mcp.auth';
import { mcpRateLimit } from './mcp.rateLimit';
import { createMcpServer } from './mcp.server';

const router = Router();
const transports = new Map<string, StreamableHTTPServerTransport>();

async function handleMcpRequest(req: McpAuthRequest, res: any) {
  if (!req.mcp) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  try {
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport && sessionId) {
      res.status(200).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Session not found' },
        id: null,
      });
      return;
    }

    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          if (transport) {
            transports.set(newSessionId, transport);
          }
        },
      });

      transport.onclose = () => {
        const sid = transport?.sessionId;
        if (sid) transports.delete(sid);
      };

      const server = createMcpServer({
        userId: req.mcp.user.id,
        scopes: req.mcp.scopes,
      });

      await server.connect(transport);
    } else if (!transport) {
      res.status(200).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

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

router.post('/', mcpAuth, mcpRateLimit, handleMcpRequest);
router.get('/', mcpAuth, mcpRateLimit, handleMcpRequest);
router.delete('/', mcpAuth, mcpRateLimit, handleMcpRequest);

export default router;
