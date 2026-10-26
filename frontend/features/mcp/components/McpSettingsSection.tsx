"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Plug, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspaces } from "@/features/workspaces/hooks/useWorkspaces";
import { SettingsHeading, SettingsLoading, settingsCard, settingsList } from "@/features/workspaces/settings/blocks";
import { cn } from "@/lib/utils";
import {
  createMcpToken,
  listMcpGrants,
  listMcpTokens,
  revokeMcpGrant,
  revokeMcpToken,
  type CreateMcpTokenResponse,
  type McpGrant,
  type McpTokenMeta,
} from "../api/mcp.api";
import { isPollOnly, scopeName } from "../scopes";

const selectClass =
  "h-9 w-full min-w-0 rounded-xl border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const FOLLOW_CURRENT = "";

const when = (iso: string | null, never: string) => (iso ? new Date(iso).toLocaleString() : never);

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!text}>
      {copied ? <Check className="mr-2 size-3.5" /> : <Copy className="mr-2 size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function ScopeChips({ scopes }: { scopes: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Permissions">
      {scopes.map((scope) => (
        <li key={scope} className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-xs text-muted-foreground">
          {scopeName(scope)}
        </li>
      ))}
    </ul>
  );
}

/** Connect by URL: the remote connector flow (OAuth), nothing to copy but the address. */
export function ConnectorSteps({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className={cn(settingsCard, "space-y-4")}>
      <div className="flex items-start gap-3">
        <Plug className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden="true" />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Connect Claude or ChatGPT</h3>
          <p className="text-sm text-muted-foreground">
            Add Open Poll as a custom connector with this server address. You sign in here, pick a workspace and
            what the app may do; there is no token to copy.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground">
          {mcpUrl || "…"}
        </code>
        <CopyButton text={mcpUrl} label="Copy address" />
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Claude: Settings → Connectors → Add custom connector. ChatGPT: Settings → Apps &amp; Connectors, with
          developer mode on, then Create.
        </li>
        <li>Paste the address and connect. Your browser opens Open Poll to sign in.</li>
        <li>Choose the workspace and permissions, then Allow. The app appears under Connected apps below.</li>
      </ol>
    </div>
  );
}

export function ConnectedAppsList({ grants, onRevoke }: { grants: readonly McpGrant[]; onRevoke: (grant: McpGrant) => void }) {
  if (!grants.length) {
    return <p className="text-sm text-muted-foreground">No apps connected yet.</p>;
  }
  return (
    <ul className={settingsList}>
      {grants.map((grant) => (
        <li key={grant.id} className="flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="min-w-0 space-y-1.5">
            <p className="truncate text-sm font-medium text-foreground">{grant.clientName}</p>
            <p className="text-xs text-muted-foreground">
              {grant.workspace.name ?? "A workspace you left"} · Last used {when(grant.lastUsedAt, "never")}
            </p>
            <ScopeChips scopes={grant.scopes} />
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => onRevoke(grant)}>
            Disconnect
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function TokenList({
  tokens,
  workspaceNames,
  onRevoke,
}: {
  tokens: readonly McpTokenMeta[];
  workspaceNames: ReadonlyMap<string, string>;
  onRevoke: (token: McpTokenMeta) => void;
}) {
  if (!tokens.length) {
    return <p className="text-sm text-muted-foreground">No personal access tokens yet.</p>;
  }
  return (
    <ul className={settingsList}>
      {tokens.map((token) => (
        <li key={token.id} className="flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              <span className="truncate">{token.label}</span>
              {isPollOnly(token.scopes) ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  Polls only
                </span>
              ) : null}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {token.prefix}…{token.last4}
            </p>
            <p className="text-xs text-muted-foreground">
              {token.workspaceId ? (workspaceNames.get(token.workspaceId) ?? "A workspace you left") : "Your current workspace"} ·{" "}
              {token.lastUsedAt ? `Last used ${when(token.lastUsedAt, "")}` : "Never used"}
            </p>
            {isPollOnly(token.scopes) ? (
              <p className="text-xs text-muted-foreground">
                Issued before decks and live sessions reached MCP. Generate a new token to use them.
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={() => onRevoke(token)}
            title="Revoke token"
            aria-label={`Revoke ${token.label}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function McpSettingsSection() {
  const { workspaces } = useWorkspaces();
  const [label, setLabel] = useState("Claude Desktop");
  const [tokenWorkspace, setTokenWorkspace] = useState(FOLLOW_CURRENT);
  const [tokens, setTokens] = useState<McpTokenMeta[]>([]);
  const [grants, setGrants] = useState<McpGrant[]>([]);
  const [mcpUrl, setMcpUrl] = useState("");
  const [issued, setIssued] = useState<CreateMcpTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tokenData, grantData] = await Promise.all([listMcpTokens(), listMcpGrants()]);
    return { tokenData, grantData };
  }, []);

  const apply = useCallback((data: Awaited<ReturnType<typeof load>>) => {
    setTokens(data.tokenData.tokens);
    setMcpUrl(data.tokenData.mcpUrl);
    setGrants(data.grantData);
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      apply(await load());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP settings");
    }
  }, [apply, load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await load();
        if (!cancelled) apply(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load MCP settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, load]);

  const handleGenerate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await createMcpToken(label.trim(), tokenWorkspace || null);
      setIssued(result);
      setMcpUrl(result.mcpUrl);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create MCP token");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeToken = async (token: McpTokenMeta) => {
    setError(null);
    try {
      await revokeMcpToken(token.id);
      if (issued?.meta.id === token.id) setIssued(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    }
  };

  const handleRevokeGrant = async (grant: McpGrant) => {
    setError(null);
    try {
      await revokeMcpGrant(grant.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect the app");
    }
  };

  const configText = issued ? JSON.stringify(issued.connectorConfig, null, 2) : "";
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace._id, workspace.name]));

  return (
    <section id="mcp" className="scroll-mt-20 space-y-8">
      <SettingsHeading
        title="MCP integration"
        description="Let Claude, ChatGPT or your editor draft decks, run live sessions with your room and read the results back. Deleting things stays in the web app."
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <ConnectorSteps mcpUrl={mcpUrl} />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Connected apps</h3>
        {loading ? <SettingsLoading>Loading connected apps…</SettingsLoading> : (
          <ConnectedAppsList grants={grants} onRevoke={(grant) => void handleRevokeGrant(grant)} />
        )}
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Personal access tokens</h3>
          <p className="text-sm text-muted-foreground">
            For clients configured by file, like Claude Desktop or Cursor: generate a token and paste the config it
            comes with.
          </p>
        </div>

        <div className={cn(settingsCard, "space-y-5")}>
          <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="mcp-label">Token label</Label>
              <Input id="mcp-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Claude Desktop" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mcp-workspace">Acts in</Label>
              <select
                id="mcp-workspace"
                value={tokenWorkspace}
                onChange={(event) => setTokenWorkspace(event.target.value)}
                className={selectClass}
              >
                <option value={FOLLOW_CURRENT}>Your current workspace</option>
                {workspaces.map((workspace) => (
                  <option key={workspace._id} value={workspace._id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              className="sm:col-span-2 sm:justify-self-end"
              onClick={() => void handleGenerate()}
              disabled={submitting || !label.trim()}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : "Generate token"}
            </Button>
          </div>

          {issued ? (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Copy this config now</p>
                  <p className="text-xs text-muted-foreground">
                    The raw token is embedded below and won&apos;t be shown again.
                  </p>
                </div>
                <CopyButton text={configText} label="Copy config" />
              </div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground">
                {configText}
              </pre>
            </div>
          ) : null}
        </div>

        {loading ? <SettingsLoading>Loading tokens…</SettingsLoading> : (
          <TokenList tokens={tokens} workspaceNames={workspaceNames} onRevoke={(token) => void handleRevokeToken(token)} />
        )}
      </div>
    </section>
  );
}
