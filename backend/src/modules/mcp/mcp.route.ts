import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { mcpAuth, type McpAuthRequest } from './mcp.auth';
import { mcpRateLimit } from './mcp.rateLimit';
import { createMcpServer } from './mcp.server';

const router = Router();

interface McpSession {
  transport: StreamableHTTPServerTransport;
  userId: string;
  lastAccessedAt: number;
}

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const sessions = new Map<string, McpSession>();

function evictStaleSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION_IDLE_TIMEOUT_MS) {
      session.transport.close().catch(() => {});
      sessions.delete(sessionId);
    }
  }
}

async function handleMcpRequest(req: McpAuthRequest, res: any) {
  if (!req.mcp) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  evictStaleSessions();

  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  try {
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (session && session.userId !== req.mcp.user.id) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Session does not belong to this token' },
        id: null,
      });
      return;
    }

    if (!session && sessionId) {
      res.status(200).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Session not found' },
        id: null,
      });
      return;
    }

    let transport: StreamableHTTPServerTransport;

    if (!session && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, {
            transport,
            userId: req.mcp!.user.id,
            lastAccessedAt: Date.now(),
          });
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      const server = createMcpServer({
        userId: req.mcp.user.id,
        tokenId: req.mcp.tokenId,
        scopes: req.mcp.scopes,
      });

      await server.connect(transport);
    } else if (!session) {
      res.status(200).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    } else {
      transport = session.transport;
      session.lastAccessedAt = Date.now();
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
