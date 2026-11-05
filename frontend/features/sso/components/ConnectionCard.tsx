"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { selectClass } from "@/features/workspaces/members/components/RoleSelect";
import { ROLE_NAMES } from "@/features/workspaces/types";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import {
  addDomain,
  deleteConnection,
  importMetadata,
  removeDomain,
  startTest,
  updateConnection,
  verifyDomain,
} from "../api/sso.api";
import { SSO_ROLES, type SsoConnection, type SsoRole } from "../types";
import { CopyValue } from "@/features/workspaces/settings/CopyValue";

const sectionTitle = "text-sm font-semibold text-foreground";
const pill = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";

const formatDate = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * One SSO connection: on/off, test sign-in, what to enter in the IdP, the
 * IdP's details, verified domains and who gets in with which role.
 */
export function ConnectionCard({
  workspaceId,
  connection,
  onChange,
  onRemoved,
}: {
  workspaceId: string;
  connection: SsoConnection;
  onChange: (next: SsoConnection) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [metadata, setMetadata] = useState("");
  const [manual, setManual] = useState(false);
  const [saml, setSaml] = useState({
    idpEntityId: connection.saml?.idpEntityId ?? "",
    idpSsoUrl: connection.saml?.idpSsoUrl ?? "",
    certificate: "",
  });
  const [mapping, setMapping] = useState(connection.saml?.attributeMapping ?? { email: "email", name: "displayName", groups: "groups" });
  const [oidc, setOidc] = useState({ issuer: connection.oidc?.issuer ?? "", clientId: connection.oidc?.clientId ?? "", clientSecret: "" });
  const [domain, setDomain] = useState("");
  const [groupRoles, setGroupRoles] = useState(connection.groupRoles);

  async function run(key: string, action: () => Promise<SsoConnection | void>, done?: string) {
    setBusy(key);
    try {
      const next = await action();
      if (next) onChange(next);
      if (done) toast.success(done);
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const update = (key: string, input: Record<string, unknown>, done?: string) =>
    run(key, () => updateConnection(workspaceId, connection.id, input), done);

  const sp = connection.serviceProvider;

  return (
    <article aria-label={connection.name} className="divide-y divide-border rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            {connection.name}
            <span className={cn(pill, "border-border text-muted-foreground")}>{connection.type === "saml" ? "SAML" : "OIDC"}</span>
          </h3>
          <p className="text-sm text-muted-foreground">
            {connection.enabled ? "On: people with a verified domain sign in here." : connection.missing.length ? `Add ${connection.missing.join(" and ")} to turn it on.` : "Off."}
            {connection.lastLoginAt ? ` Last sign-in ${formatDate(connection.lastLoginAt)}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="bg-card"
            disabled={busy !== null || (connection.type === "saml" ? !connection.saml : !connection.oidc)}
            onClick={() =>
              void run("test", async () => {
                window.location.assign(await startTest(workspaceId, connection.id));
              })
            }
          >
            {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : null}
            Test sign-in
          </Button>
          <Label className="flex items-center gap-2 text-sm font-medium">
            <Switch
              checked={connection.enabled}
              disabled={busy !== null || (!connection.enabled && connection.missing.length > 0)}
              onCheckedChange={(enabled) => void update("enabled", { enabled }, enabled ? "Single sign-on is on" : "Single sign-on is off")}
              aria-label={`Sign-in through ${connection.name}`}
            />
            {connection.enabled ? "On" : "Off"}
          </Label>
        </div>
      </header>

      {connection.lastTest ? (
        <p className="px-5 py-3 text-sm text-muted-foreground sm:px-6">
          Last test {formatDate(connection.lastTest.at)}: signed in as {connection.lastTest.email}
          {connection.lastTest.groups.length ? ` (groups: ${connection.lastTest.groups.join(", ")})` : ""}.
        </p>
      ) : null}

      <section aria-label="Values for your identity provider" className="space-y-3 px-5 py-4 sm:px-6">
        <h4 className={sectionTitle}>In your identity provider</h4>
        {connection.type === "saml" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <CopyValue label="Entity ID (audience)" value={sp.entityId} />
            <CopyValue label="ACS URL (reply URL)" value={sp.acsUrl} />
            <CopyValue label="Metadata URL" value={sp.metadataUrl} />
            <CopyValue label="Sign-in URL (for app tiles)" value={sp.loginUrl} />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <CopyValue label="Redirect URI" value={sp.oidcRedirectUri} />
            <CopyValue label="Sign-in URL" value={sp.loginUrl} />
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Send the email address{connection.type === "saml" ? " (as the NameID or an email attribute)" : " claim, verified"} and, if you map roles, the groups.
        </p>
      </section>

      <section aria-label="Identity provider" className="space-y-3 px-5 py-4 sm:px-6">
        <h4 className={sectionTitle}>Identity provider</h4>
        {connection.type === "saml" ? (
          <>
            {connection.saml ? (
              <p className="text-sm text-muted-foreground">
                {connection.saml.idpEntityId} · {connection.saml.certificates} signing certificate{connection.saml.certificates === 1 ? "" : "s"}
              </p>
            ) : null}
            {!manual ? (
              <div className="space-y-2">
                <Label htmlFor={`${connection.id}-metadata`}>Paste the IdP metadata XML</Label>
                <Textarea
                  id={`${connection.id}-metadata`}
                  rows={4}
                  value={metadata}
                  onChange={(e) => setMetadata(e.target.value)}
                  className="bg-card font-mono text-xs"
                  placeholder="<EntityDescriptor …>"
                />
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="bg-card"
                    disabled={busy !== null || metadata.trim().length < 50}
                    onClick={() =>
                      void run("metadata", async () => {
                        const next = await importMetadata(workspaceId, connection.id, metadata);
                        setMetadata("");
                        return next;
                      }, "Identity provider details saved")
                    }
                  >
                    Import metadata
                  </Button>
                  <Button variant="ghost" onClick={() => setManual(true)}>
                    Enter the details instead
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${connection.id}-entity`}>IdP entity ID (issuer)</Label>
                  <Input id={`${connection.id}-entity`} value={saml.idpEntityId} onChange={(e) => setSaml({ ...saml, idpEntityId: e.target.value })} className="bg-card" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${connection.id}-sso-url`}>IdP sign-in URL</Label>
                  <Input id={`${connection.id}-sso-url`} type="url" value={saml.idpSsoUrl} onChange={(e) => setSaml({ ...saml, idpSsoUrl: e.target.value })} className="bg-card" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor={`${connection.id}-cert`}>Signing certificate (PEM)</Label>
                  <Textarea id={`${connection.id}-cert`} rows={4} value={saml.certificate} onChange={(e) => setSaml({ ...saml, certificate: e.target.value })} className="bg-card font-mono text-xs" />
                </div>
                <div className="flex gap-3 md:col-span-2">
                  <Button
                    variant="outline"
                    className="bg-card"
                    disabled={busy !== null || !saml.idpEntityId || !saml.idpSsoUrl || saml.certificate.trim().length < 64}
                    onClick={() =>
                      void update(
                        "saml",
                        { saml: { idpEntityId: saml.idpEntityId, idpSsoUrl: saml.idpSsoUrl, idpCerts: [saml.certificate], attributeMapping: mapping } },
                        "Identity provider details saved",
                      )
                    }
                  >
                    Save details
                  </Button>
                  <Button variant="ghost" onClick={() => setManual(false)}>
                    Import metadata instead
                  </Button>
                </div>
              </div>
            )}
            {connection.saml ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-foreground">Attribute names</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {(["email", "name", "groups"] as const).map((key) => (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={`${connection.id}-attr-${key}`} className="capitalize">
                        {key}
                      </Label>
                      <Input id={`${connection.id}-attr-${key}`} value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })} className="bg-card font-mono text-xs" />
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 bg-card"
                  disabled={busy !== null}
                  onClick={() =>
                    void update(
                      "mapping",
                      { saml: { attributeMapping: mapping } },
                      "Attribute names saved",
                    )
                  }
                >
                  Save attribute names
                </Button>
              </details>
            ) : null}
          </>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor={`${connection.id}-issuer`}>Issuer URL</Label>
              <Input id={`${connection.id}-issuer`} type="url" value={oidc.issuer} onChange={(e) => setOidc({ ...oidc, issuer: e.target.value })} className="bg-card" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${connection.id}-client`}>Client ID</Label>
              <Input id={`${connection.id}-client`} value={oidc.clientId} onChange={(e) => setOidc({ ...oidc, clientId: e.target.value })} className="bg-card" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${connection.id}-secret`}>Client secret</Label>
              <Input
                id={`${connection.id}-secret`}
                type="password"
                autoComplete="off"
                placeholder={connection.oidc?.clientSecretSet ? "Stored; type to replace" : ""}
                value={oidc.clientSecret}
                onChange={(e) => setOidc({ ...oidc, clientSecret: e.target.value })}
                className="bg-card"
              />
            </div>
            <div className="md:col-span-2">
              <Button
                variant="outline"
                className="bg-card"
                disabled={busy !== null || !oidc.issuer || !oidc.clientId}
                onClick={() =>
                  void update(
                    "oidc",
                    { oidc: { issuer: oidc.issuer, clientId: oidc.clientId, ...(oidc.clientSecret ? { clientSecret: oidc.clientSecret } : {}) } },
                    "Identity provider details saved",
                  ).then(() => setOidc((o) => ({ ...o, clientSecret: "" })))
                }
              >
                Save details
              </Button>
            </div>
          </div>
        )}
      </section>

      <section aria-label="Domains" className="space-y-3 px-5 py-4 sm:px-6">
        <h4 className={sectionTitle}>Domains</h4>
        <p className="text-sm text-muted-foreground">
          People whose email is in a verified domain sign in here. Prove each domain with a DNS TXT record.
        </p>
        {connection.domains.length ? (
          <ul className="space-y-3">
            {connection.domains.map((d) => (
              <li key={d.domain} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {d.domain}
                    <span className={cn(pill, d.verified ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning")}>
                      {d.verified ? "Verified" : "Waiting for DNS"}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    {!d.verified ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-card"
                        disabled={busy !== null}
                        onClick={() => void run(`verify-${d.domain}`, () => verifyDomain(workspaceId, connection.id, d.domain), `${d.domain} verified`)}
                      >
                        {busy === `verify-${d.domain}` ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        Verify
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${d.domain}`}
                      disabled={busy !== null}
                      onClick={() => void run(`remove-${d.domain}`, () => removeDomain(workspaceId, connection.id, d.domain))}
                    >
                      <X className="size-4" />
                    </Button>
                  </span>
                </div>
                {!d.verified ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    <CopyValue label="TXT record name" value={d.record.host} />
                    <CopyValue label="TXT record value" value={d.record.value} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!domain.trim()) return;
            void run("domain", async () => {
              const next = await addDomain(workspaceId, connection.id, domain);
              setDomain("");
              return next;
            });
          }}
        >
          <Label htmlFor={`${connection.id}-domain`} className="sr-only">
            Domain
          </Label>
          <Input id={`${connection.id}-domain`} placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} className="h-9 max-w-xs bg-card" />
          <Button type="submit" variant="outline" className="bg-card" disabled={busy !== null || !domain.trim()}>
            <Plus className="size-4" /> Add domain
          </Button>
        </form>
      </section>

      <section aria-label="Access" className="space-y-4 px-5 py-4 sm:px-6">
        <h4 className={sectionTitle}>Access</h4>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Label htmlFor={`${connection.id}-jit`} className="text-sm font-medium">
              Create accounts on first sign-in
            </Label>
            <p className="text-sm text-muted-foreground">Off: only existing members (or SCIM-provisioned people) get in.</p>
          </div>
          <Switch id={`${connection.id}-jit`} checked={connection.jit} disabled={busy !== null} onCheckedChange={(jit) => void update("jit", { jit })} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Label htmlFor={`${connection.id}-role`} className="text-sm font-medium">
            Role for new members
          </Label>
          <select
            id={`${connection.id}-role`}
            className={selectClass}
            value={connection.defaultRole}
            disabled={busy !== null}
            onChange={(e) => {
              const defaultRole = e.target.value as SsoRole;
              void update("role", { defaultRole });
            }}
          >
            {SSO_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_NAMES[role]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Roles from IdP groups</p>
          <p className="text-sm text-muted-foreground">New members in a listed group get its role; the first match wins.</p>
          {groupRoles.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Group ${i + 1}`}
                value={row.group}
                onChange={(e) => setGroupRoles(groupRoles.map((r, j) => (j === i ? { ...r, group: e.target.value } : r)))}
                className="h-9 max-w-xs bg-card"
              />
              <select
                aria-label={`Role for group ${i + 1}`}
                className={selectClass}
                value={row.role}
                onChange={(e) => {
                  const role = e.target.value as SsoRole;
                  setGroupRoles(groupRoles.map((r, j) => (j === i ? { ...r, role } : r)));
                }}
              >
                {SSO_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_NAMES[role]}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove group ${i + 1}`} onClick={() => setGroupRoles(groupRoles.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="bg-card" onClick={() => setGroupRoles([...groupRoles, { group: "", role: "editor" }])}>
              <Plus className="size-3.5" /> Add group
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-card"
              disabled={busy !== null || groupRoles.some((r) => !r.group.trim())}
              onClick={() => void update("groups", { groupRoles: groupRoles.map((r) => ({ ...r, group: r.group.trim() })) }, "Group roles saved")}
            >
              Save group roles
            </Button>
          </div>
        </div>
      </section>

      <footer className="flex justify-end px-5 py-3 sm:px-6">
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={busy !== null}
          onClick={() => {
            if (!window.confirm(`Delete ${connection.name}? People stop signing in through it.`)) return;
            void run("delete", async () => {
              await deleteConnection(workspaceId, connection.id);
              onRemoved();
            }, "Connection deleted");
          }}
        >
          <Trash2 className="size-4" /> Delete connection
        </Button>
      </footer>
    </article>
  );
}
