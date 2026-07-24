"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Plug, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createMcpToken,
  listMcpTokens,
  revokeMcpToken,
  type CreateMcpTokenResponse,
  type McpTokenMeta,
} from "../api/mcp.api";

export function McpSettingsSection() {
  const [label, setLabel] = useState("Claude Desktop");
  const [tokens, setTokens] = useState<McpTokenMeta[]>([]);
  const [mcpUrl, setMcpUrl] = useState("");
  const [issued, setIssued] = useState<CreateMcpTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMcpTokens();
      setTokens(data.tokens);
      setMcpUrl(data.mcpUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await listMcpTokens();
        if (cancelled) return;
        setTokens(data.tokens);
        setMcpUrl(data.mcpUrl);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load MCP tokens");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerate = async () => {
    setSubmitting(true);
    setError(null);
    setCopied(false);
    try {
      const result = await createMcpToken(label.trim());
      setIssued(result);
      setMcpUrl(result.mcpUrl);
      await loadTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create MCP token");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    setError(null);
    try {
      await revokeMcpToken(tokenId);
      if (issued?.meta.id === tokenId) setIssued(null);
      await loadTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    }
  };

  const configText = issued
    ? JSON.stringify(issued.connectorConfig, null, 2)
    : "";

  const copyConfig = async () => {
    if (!configText) return;
    await navigator.clipboard.writeText(configText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="mcp" className="scroll-mt-20 space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-foreground/90">MCP Integration</h2>
        <p className="text-sm text-muted-foreground">
          Connect Open Poll to Claude or other MCP clients using a personal access token.
        </p>
      </div>

      <div className="rounded-[1.5rem] border border-border bg-card p-6 space-y-6">
        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-secondary/20 p-4">
          <Plug className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Generate a token, copy the connector config, and paste it into your MCP client settings.
              The connected assistant can create and edit your polls, read analytics, and fetch share links.
            </p>
            <p>Deletion and closing polls stay in the web app only.</p>
            {mcpUrl ? (
              <p className="text-xs">
                MCP endpoint: <span className="font-mono text-foreground/80">{mcpUrl}</span>
              </p>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="mcp-label">Token label</Label>
            <Input
              id="mcp-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Claude Desktop"
              className="rounded-xl"
            />
          </div>
          <Button
            onClick={() => void handleGenerate()}
            disabled={submitting || !label.trim()}
            className="rounded-xl"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : "Generate token"}
          </Button>
        </div>

        {issued ? (
          <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground/90">Copy this config now</p>
                <p className="text-xs text-muted-foreground">
                  The raw token is embedded below and won&apos;t be shown again.
                </p>
              </div>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void copyConfig()}>
                <Copy className="mr-2 size-3.5" />
                {copied ? "Copied" : "Copy config"}
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 text-xs font-mono text-foreground/80">
              {configText}
            </pre>
          </div>
        ) : null}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground/90">Active tokens</h3>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading tokens...
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active MCP tokens yet.</p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/10 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground/90">{token.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {token.prefix}…{token.last4}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {token.lastUsedAt
                        ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                        : "Never used"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={() => void handleRevoke(token.id)}
                    title="Revoke token"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
