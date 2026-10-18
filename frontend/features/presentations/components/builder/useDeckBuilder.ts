"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useIsomorphicLayoutEffect } from "@/hooks/use-isomorphic-layout-effect";
import { getApiErrorMessage } from "@/lib/api-error";
import { generatePresentationDraft } from "../../api/ai";
import { createPresentation, getPresentation, updatePresentation } from "../../api/crud";
import { blankSlide, cleanSlide } from "../../slides/editor";
import type {
  GeneratedPresentationDraft,
  GeneratePresentationInput,
  PresentationSlide,
  PresentationSlideType,
} from "../../types/deck";
import {
  buildDraftStorageKey,
  clearDraft,
  isDeckDirty,
  isSlideDirty,
  loadDraft,
  mergeGeneratedSlides,
  saveDraft,
  toDraftPayload,
  toSavePayload,
  validateDeck,
  type DeckDraft,
} from "./deckDraft";
import * as rail from "./slideRailOps";

// Prevents double-creation across remounts/rapid saves during navigation.
let isGlobalCreatingPresentation = false;

/**
 * Deck builder state: the deck being edited, the selected slide, local
 * (browser) draft persistence, silent backend drafts, explicit save, and AI
 * generation. The builder components stay presentational on top of this.
 */
export function useDeckBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id");
  const seedName = searchParams.get("name");
  const seedMode = searchParams.get("mode");

  const [title, setTitle] = useState(seedName ?? "");
  const [slides, setSlides] = useState<PresentationSlide[]>([blankSlide()]);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [aiOpen, setAiOpen] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const aiAutoOpened = useRef(false);
  const draftStorageKey = useMemo(() => buildDraftStorageKey(editId), [editId]);
  const draftHydratedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const [savingDraft, setSavingDraft] = useState(false);
  // Set right before router.replace(...?id=<newId>) so the edit-loader effect
  // below doesn't immediately refetch and stomp the in-progress local state
  // with the (normalized-for-validation) version we just persisted.
  const skipNextLoadIdRef = useRef<string | null>(null);
  const isExplicitSaveRef = useRef(false);
  const isMountedRef = useRef(true);
  // Latest deck state for async saves that may finish after unmount.
  const draftStateRef = useRef({ title, slides, editId });
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const saved = loadDraft(draftStorageKey);
    if (saved) {
      // Restoring from localStorage (external storage) must happen after mount,
      // and again whenever the draft key changes (e.g. ?id= is set after a save).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(saved.title);
      setSlides(saved.slides.length > 0 ? saved.slides : [blankSlide()]);
      setActive(Math.min(saved.active, Math.max(0, saved.slides.length - 1)));
    }
    draftHydratedRef.current = true;
  }, [draftStorageKey]);

  useEffect(() => {
    if (!editId) return;
    if (skipNextLoadIdRef.current === editId) {
      skipNextLoadIdRef.current = null;
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const presentation = await getPresentation(editId);
        setTitle(presentation.title);
        setSlides(presentation.slides);
      } catch {
        toast.error("Could not load presentation deck for editing.");
        router.push("/polls");
      } finally {
        setLoading(false);
      }
    })();
  }, [editId, router]);

  useEffect(() => {
    if (seedMode === "ai" && !editId && !aiAutoOpened.current) {
      aiAutoOpened.current = true;
      setAiOpen(true);
    }
  }, [seedMode, editId]);

  const slide = slides[active] ?? slides[0];

  const updateSlide = (patch: Partial<PresentationSlide>) => {
    setSlides((prev) => prev.map((s, i) => (i === active ? { ...s, ...patch } : s)));
  };

  const updateDeck = (patch: Partial<Omit<DeckDraft, "slides">>) => {
    if (patch.title !== undefined) setTitle(patch.title);
  };

  const applyRail = (next: rail.RailState) => {
    setSlides(next.slides);
    setActive(next.active);
  };

  const addSlide = (type: PresentationSlideType) => applyRail(rail.addSlide({ slides, active }, type));
  const moveSlide = (from: number, to: number) => applyRail(rail.moveSlide({ slides, active }, from, to));
  const duplicateSlide = (index: number) => applyRail(rail.duplicateSlide({ slides, active }, index));
  const removeSlide = (index: number) => applyRail(rail.removeSlide({ slides, active }, index));

  const handleGenerated = (draft: GeneratedPresentationDraft) => {
    const prev = draftStateRef.current;
    const generatedSlides = draft.slides.map((s) => ({ ...blankSlide(s.type), ...s }));
    const mergedSlides = mergeGeneratedSlides(prev.slides, generatedSlides);
    const mergedTitle = prev.title.trim() || draft.title || prev.title;

    // Update the ref synchronously so a save (this component's own auto-save,
    // or one already queued from an unmount that raced this generation) always
    // sees the merged result, even if this component is no longer mounted.
    draftStateRef.current = { ...prev, title: mergedTitle, slides: mergedSlides };

    if (isMountedRef.current) {
      if (!prev.title.trim() && draft.title) setTitle(draft.title);
      setSlides(mergedSlides);
      setActive(Math.max(0, mergedSlides.length - generatedSlides.length));
    }

    // Persist immediately regardless of mount state — if the user navigated
    // away while generation was in flight, this is the only place the AI
    // result still gets saved (the unmount auto-save already fired earlier
    // and can't know about a result that arrives after it).
    void persistAsDraftRef.current?.(true);
  };

  const handleAiGenerate = async (params: Pick<GeneratePresentationInput, "topic" | "slideCount" | "slideTypes">) => {
    setIsAiGenerating(true);
    const toastId = toast.loading("AI is drafting your slides...");
    try {
      const draft = await generatePresentationDraft(params);
      handleGenerated(draft);
      if (isMountedRef.current) {
        toast.success(`Generated ${draft.slides.length} slides — review and tweak before saving.`, { id: toastId });
      }
    } catch (err) {
      if (isMountedRef.current) {
        toast.error(getApiErrorMessage(err) || "AI deck generation failed.", { id: toastId });
      }
    } finally {
      if (isMountedRef.current) setIsAiGenerating(false);
    }
  };

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (editId === null && !title.trim() && slides.length === 1 && !isSlideDirty(slides[0]!)) {
      return;
    }

    draftDirtyRef.current = true;
    const timeout = window.setTimeout(() => {
      saveDraft(draftStorageKey, { title, slides, active });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [title, slides, active, draftStorageKey, editId]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (!draftDirtyRef.current) return;
      saveDraft(draftStorageKey, { title, slides, active });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (draftDirtyRef.current) {
        saveDraft(draftStorageKey, { title, slides, active });
      }
    };
  }, [draftStorageKey, title, slides, active]);

  useEffect(() => {
    draftStateRef.current = { title, slides, editId };
  }, [title, slides, editId]);

  const searchParamsStrRef = useRef(searchParams.toString());
  useEffect(() => {
    searchParamsStrRef.current = searchParams.toString();
  }, [searchParams]);

  // A queue instead of a boolean lock: overlapping save triggers (unmount +
  // an AI result landing moments later, etc.) run one after another instead
  // of the later one being silently dropped — each run reads the ref fresh,
  // so the final save always reflects the latest merged state.
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  const runPersistDraft = async (silent: boolean) => {
    const { title: t, slides: s, editId: id } = draftStateRef.current;
    if (!isDeckDirty(t, s)) return;

    isExplicitSaveRef.current = true;
    // Cross-instance guard only (e.g. dev StrictMode double-mount) — same
    // instance calls are already serialized by persistQueueRef.
    if (!id && isGlobalCreatingPresentation) return;
    if (!id) isGlobalCreatingPresentation = true;

    try {
      const payload = toDraftPayload(t, s);
      if (id) {
        await updatePresentation(id, payload);
        clearDraft(buildDraftStorageKey(id));
        if (!silent) toast.success("Draft updated");
      } else {
        const created = await createPresentation(payload);
        // Set this directly (not just via the URL) so a later queued save —
        // possibly firing after this component unmounted — still targets the
        // same record instead of creating a duplicate.
        draftStateRef.current = { ...draftStateRef.current, editId: created._id };
        clearDraft(buildDraftStorageKey(null));
        if (isMountedRef.current) {
          skipNextLoadIdRef.current = created._id;
          const params = new URLSearchParams(searchParamsStrRef.current);
          params.set("id", created._id);
          router.replace(`/presentation/create?${params.toString()}`, { scroll: false });
        }
        if (!silent) toast.success("Saved to drafts");
      }
    } catch {
      isExplicitSaveRef.current = false;
      if (!silent) toast.error("Could not save draft");
    } finally {
      if (!id) isGlobalCreatingPresentation = false;
    }
  };

  const persistAsDraft = (silent: boolean) => {
    const next = persistQueueRef.current.then(() => runPersistDraft(silent)).catch(() => {});
    persistQueueRef.current = next;
    return next;
  };
  // Latest persist function for async callers and the unmount cleanup; updated
  // after each commit instead of during render.
  const persistAsDraftRef = useRef(persistAsDraft);
  useIsomorphicLayoutEffect(() => {
    persistAsDraftRef.current = persistAsDraft;
  });

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    await persistAsDraftRef.current?.(false);
    setSavingDraft(false);
  };

  // Silently persists the deck as a real backend draft if the user navigates
  // away without explicitly saving/publishing — parity with the poll builder.
  useEffect(() => {
    return () => {
      if (isExplicitSaveRef.current) return;
      if (!draftHydratedRef.current) return;
      void persistAsDraftRef.current?.(true);
    };
  }, []);

  const handleSave = async () => {
    const cleaned = slides.map(cleanSlide);

    const error = validateDeck(title, cleaned);
    if (error) {
      toast.error(error);
      return;
    }

    setSaving(true);
    isExplicitSaveRef.current = true;
    try {
      const payload = toSavePayload(title, cleaned);
      if (editId) {
        await updatePresentation(editId, payload);
        toast.success("Presentation deck updated!");
      } else {
        await createPresentation(payload);
        toast.success("Presentation deck created!");
      }
      clearDraft(draftStorageKey);
      router.push("/polls");
    } catch (err) {
      isExplicitSaveRef.current = false;
      toast.error(getApiErrorMessage(err) || "Failed to save presentation deck.");
    } finally {
      setSaving(false);
    }
  };

  return {
    editId,
    loading,
    deck: { title, slides } satisfies DeckDraft,
    title,
    setTitle,
    slides,
    active,
    setActive,
    slide,
    updateSlide,
    updateDeck,
    addSlide,
    moveSlide,
    duplicateSlide,
    removeSlide,
    saving,
    savingDraft,
    handleSave,
    handleSaveDraft,
    aiOpen,
    setAiOpen,
    isAiGenerating,
    handleGenerated,
    handleAiGenerate,
  };
}
