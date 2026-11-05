"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { LayoutTemplate, Loader2, MoreHorizontal, Presentation, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCanOrganizeLibrary } from "@/features/library/hooks/useFolders";
import { deckBuilderPath } from "@/features/library/query";
import { slideTypeMeta } from "@/features/presentations/slides/meta";
import type { PresentationSlideType } from "@/features/presentations/types/deck";
import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { useAppThemeMode } from "@/features/themes/useAppThemeMode";
import { createDeckFromTemplate, deleteTemplate, listTemplates, type TemplateList, type TemplateSummary } from "../api";

/**
 * `/templates`: the starter decks every workspace gets, then the templates
 * this workspace saved ("Save as template" on a deck card). "Use template"
 * makes a new draft deck and opens it in the builder.
 */
export function TemplatesView() {
  const router = useRouter();
  const appMode = useAppThemeMode();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const canCreate = useCanOrganizeLibrary();
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ key: string; list: TemplateList | null; error: string | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateSummary | null>(null);
  const key = `${workspaceId ?? ""}#${generation}`;

  useEffect(() => {
    let cancelled = false;
    listTemplates().then(
      (list) => !cancelled && setState({ key, list, error: null }),
      (error: unknown) => !cancelled && setState({ key, list: null, error: getApiErrorMessage(error) ?? "Could not load templates." }),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  const current = state?.key === key ? state : null;

  async function use(template: TemplateSummary) {
    setBusyId(template.id);
    try {
      const deck = await createDeckFromTemplate(template.id, appMode);
      toast.success(`“${deck.title}” created from the template.`);
      router.push(deckBuilderPath(deck._id));
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't create a deck from this template.");
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteTemplate(deleteTarget.id);
      toast.success("Template deleted.");
      setState((prev) =>
        prev?.list ? { ...prev, list: { ...prev.list, workspace: prev.list.workspace.filter((item) => item.id !== deleteTarget.id) } } : prev,
      );
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't delete the template.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <header>
        <h1 className="text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">Templates</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Start a deck from a proven structure. Each template becomes a new draft you can edit before presenting.
        </p>
        {!canCreate && current?.list ? (
          <p className="mt-3 text-sm text-muted-foreground">Your role in this workspace can view templates but not create decks.</p>
        ) : null}
      </header>

      {current === null ? (
        <TemplateGridSkeleton />
      ) : current.error ? (
        <div className="mt-10 flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <span>{current.error}</span>
          <Button variant="outline" size="sm" onClick={reload} className="border-destructive/30 text-destructive hover:bg-destructive/10">
            <RefreshCw /> Retry
          </Button>
        </div>
      ) : current.list ? (
        <>
          <section aria-labelledby="starter-templates" className="mt-10">
            <h2 id="starter-templates" className="text-xl font-semibold tracking-[-0.02em]">
              Starter templates
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {current.list.starter.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  canCreate={canCreate}
                  busy={busyId === template.id}
                  disabled={busyId !== null}
                  onUse={() => void use(template)}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="workspace-templates" className="mt-12">
            <h2 id="workspace-templates" className="text-xl font-semibold tracking-[-0.02em]">
              Saved in this workspace
            </h2>
            {current.list.workspace.length === 0 ? (
              <div className="relative mt-4 overflow-hidden rounded-2xl border border-border bg-card px-6 py-12 text-center">
                <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
                <div className="relative">
                  <LayoutTemplate className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-4 text-base font-semibold text-foreground">No saved templates yet</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    In the library, open a deck&apos;s menu and choose Save as template. Your team can then start from it here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {current.list.workspace.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    canCreate={canCreate}
                    busy={busyId === template.id}
                    disabled={busyId !== null}
                    onUse={() => void use(template)}
                    onDelete={canCreate ? () => setDeleteTarget(template) : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && busyId === null && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>&quot;{deleteTarget?.title}&quot;</strong> is removed from this workspace&apos;s templates. Decks already made from it
              are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface TemplateCardProps {
  template: TemplateSummary;
  canCreate: boolean;
  busy: boolean;
  disabled: boolean;
  onUse: () => void;
  onDelete?: () => void;
}

function TemplateCard({ template, canCreate, busy, disabled, onUse, onDelete }: TemplateCardProps) {
  const headingId = `template-${template.id}`;
  return (
    <article
      aria-labelledby={headingId}
      className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-card", busy && "opacity-70")}
    >
      <TemplatePreview template={template} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-2">
          <h3 id={headingId} className="min-w-0 flex-1 text-base font-semibold leading-snug tracking-[-0.015em] text-foreground">
            {template.title}
          </h3>
          {onDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`More actions for ${template.title}`}
                  className="-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 p-1.5">
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 /> Delete template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono text-xs tabular-nums text-foreground">{template.slideCount}</span> slides
          {template.source === "workspace" && template.createdBy ? <>, saved by {template.createdBy.name}</> : null}
          {template.source === "workspace" && template.updatedAt ? (
            <> {formatDistanceToNowStrict(new Date(template.updatedAt), { addSuffix: true })}</>
          ) : null}
        </p>
        {template.description ? <p className="mt-3 text-sm text-foreground/80">{template.description}</p> : null}
        {template.outline.length ? (
          <ol className="mt-3 space-y-1 text-sm text-muted-foreground" aria-label={`First slides of ${template.title}`}>
            {template.outline.slice(0, 4).map((label, index) => (
              <li key={`${index}-${label}`} className="flex gap-2">
                <span className="w-4 shrink-0 font-mono text-xs leading-5 tabular-nums text-faint">{index + 1}</span>
                <span className="line-clamp-1">{label}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="mt-auto flex justify-end pt-5">
          <Button
            size="sm"
            variant="ink"
            disabled={!canCreate || disabled}
            onClick={onUse}
            aria-label={`Use template ${template.title}`}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Presentation />} Use template
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Graph paper with the category and a mini screen of the slide types (in the app's light or dark, the mode a new deck takes). */
function TemplatePreview({ template }: { template: TemplateSummary }) {
  const types = template.slideTypes.slice(0, 5);
  return (
    <div aria-hidden="true" className="relative h-28 overflow-hidden border-b border-border bg-background">
      <div className="mk-grid mk-grid-flat absolute inset-0" />
      {template.category ? (
        <span className="absolute left-3 top-3 z-10 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground">
          {template.category}
        </span>
      ) : null}
      <div className="relative flex h-full items-center justify-center px-6 pt-5">
        {/* The mini screen follows the app theme: a deck made from the template starts in it. */}
        <div className="w-full max-w-[12rem] rounded-lg border border-border bg-background p-2.5 shadow-[0_12px_24px_-16px_rgb(23_23_23/0.45)]">
          <span className="block h-1.5 w-1/2 rounded-full bg-foreground/70" />
          <div className="mt-2.5 flex items-center gap-1.5">
            {types.map((type) => {
              const { Icon } = slideTypeMeta(type as PresentationSlideType);
              return (
                <span key={type} className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-accent-ink">
                  <Icon className="size-3.5" />
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateGridSkeleton() {
  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="h-28 animate-pulse border-b border-border bg-muted/60" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
