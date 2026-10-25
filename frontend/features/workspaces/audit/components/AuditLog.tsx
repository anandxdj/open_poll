"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api-error";
import { useCurrentWorkspace } from "../../hooks/useWorkspaces";
import { listMembers } from "../../members/api/members.api";
import { selectClass } from "../../members/components/RoleSelect";
import type { Member } from "../../members/types";
import { listAuditEvents } from "../api/audit.api";
import { actionOptions, describeAction, describeActor, describeEvent } from "../format";
import type { AuditEvent } from "../types";

const card = "rounded-xl border border-border bg-card p-5 sm:p-6";

interface Filters {
  action: string;
  actor: string;
}

const NO_FILTERS: Filters = { action: "", actor: "" };

function AuditPanel({ workspaceId, retentionDays }: { workspaceId: string; retentionDays: number | null }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listMembers(workspaceId).then(
      (roster) => {
        if (!cancelled) setMembers(roster.members);
      },
      () => undefined, // The actor filter is a convenience; the log works without it.
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // First page (and every filter change).
  useEffect(() => {
    let cancelled = false;
    listAuditEvents({ action: filters.action, actor: filters.actor }).then(
      (page) => {
        if (cancelled) return;
        setEvents(page.events);
        setCursor(page.nextCursor);
        // The action list only comes with an unfiltered first page's request; keep the last one otherwise.
        if (page.actions.length > 0) setActions(page.actions);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(getApiErrorMessage(err) ?? "Couldn't load the audit log");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [filters, version, workspaceId]);

  const update = (next: Filters) => {
    setLoading(true);
    setFilters(next);
  };

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listAuditEvents({ action: filters.action, actor: filters.actor, cursor });
      setEvents((current) => [...current, ...page.events]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Couldn't load more events");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, filters]);

  const filtered = filters.action !== "" || filters.actor !== "";

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">Audit log</h2>
        <p className="text-sm text-muted-foreground">
          Who changed members, invitations, sharing and settings in this workspace.{" "}
          {retentionDays === null ? "Events are kept without a time limit." : `Events are kept for ${retentionDays} days on this plan.`}
        </p>
      </div>

      <div className={`${card} space-y-5`}>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="audit-action">Action</Label>
            <select
              id="audit-action"
              value={filters.action}
              onChange={(event) => update({ ...filters, action: event.target.value })}
              className={`${selectClass} w-full`}
            >
              {actionOptions(actions).map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-actor">Person</Label>
            <select
              id="audit-actor"
              value={filters.actor}
              onChange={(event) => update({ ...filters, actor: event.target.value })}
              className={`${selectClass} w-full`}
            >
              <option value="">Everyone</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="ghost" disabled={!filtered} onClick={() => update(NO_FILTERS)}>
            Clear filters
          </Button>
        </div>

        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
            {error}
            <Button type="button" variant="outline" size="sm" onClick={() => setVersion((value) => value + 1)}>
              Try again
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading events…
          </div>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filtered ? "No events match these filters." : "Nothing has been recorded yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Audit events, newest first</caption>
              <thead>
                <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-semibold">When</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Who</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">What</th>
                  <th scope="col" className="py-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {events.map((event) => (
                  <tr key={event.id} data-testid="audit-row" data-action={event.action} className="align-top">
                    <td className="whitespace-nowrap py-3 pr-4 text-muted-foreground">
                      <time dateTime={event.createdAt} title={event.ip ? `IP ${event.ip}` : undefined}>
                        {format(new Date(event.createdAt), "MMM d, yyyy HH:mm")}
                      </time>
                    </td>
                    <td className="py-3 pr-4 text-foreground">{describeActor(event)}</td>
                    <td className="py-3 pr-4 font-medium text-foreground">{describeAction(event.action)}</td>
                    <td className="py-3 text-muted-foreground">{describeEvent(event)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cursor ? (
          <div className="flex justify-center">
            <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? <Loader2 className="size-4 animate-spin" /> : "Load older events"}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Content of /settings/audit: filterable, paginated workspace events (owners and admins). */
export function AuditLog() {
  const { detail, failed, retry } = useCurrentWorkspace();

  if (failed) {
    return (
      <div className={`${card} space-y-3`}>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this workspace.</p>
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading workspace…
      </div>
    );
  }
  if (!detail.permissions.includes("workspace:manage")) {
    return (
      <div className={`${card} space-y-2`}>
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">Audit log</h2>
        <p className="text-sm text-muted-foreground">Only owners and admins can see the audit log.</p>
      </div>
    );
  }
  return <AuditPanel key={detail.workspace._id} workspaceId={detail.workspace._id} retentionDays={detail.entitlements.limits.auditRetentionDays} />;
}
