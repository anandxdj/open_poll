"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
  Presentation as PresentationIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createPresentation, generatePresentationDraft, getPresentation, updatePresentation } from "../api/presentationApi";
import { slideTypeMeta } from "../slideTypeMeta";
import { AiPresentationModal } from "./AiPresentationModal";
import { SlideTypePicker } from "./SlideTypePicker";
import { isScoredSlideType, type GeneratedPresentationDraft, type PresentationSlide, type PresentationSlideType } from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

const buildDraftStorageKey = (presentationId: string | null) =>
  presentationId ? `openpoll_presentation_draft_${presentationId}` : "openpoll_presentation_draft_new";

type PersistedPresentationDraft = {
  title: string;
  slides: PresentationSlide[];
  active: number;
};

function loadDraft(storageKey: string): PersistedPresentationDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPresentationDraft;
    if (!parsed || typeof parsed.title !== "string" || !Array.isArray(parsed.slides)) {
      return null;
    }
    return {
      title: parsed.title,
      slides: parsed.slides,
      active: typeof parsed.active === "number" ? parsed.active : 0,
    };
  } catch {
    return null;
  }
}

function saveDraft(storageKey: string, draft: PersistedPresentationDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {}
}

function clearDraft(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {}
}

const blankSlide = (type: PresentationSlideType = "select_answer"): PresentationSlide => ({
  type,
  question: "",
  options:
    type === "select_answer"
      ? [
          { text: "", isCorrect: true },
          { text: "", isCorrect: false },
        ]
      : [],
  acceptedAnswers: [],
  statements: type === "scales" ? [""] : [],
  minLabel: type === "scales" ? "Disagree" : "",
  maxLabel: type === "scales" ? "Agree" : "",
  scaleMax: 5,
  items: type === "ranking" ? ["", ""] : [],
  maxEntries: 3,
  timeLimit: type === "open_ended" ? 60 : 30,
  points: isScoredSlideType(type) ? 1000 : 0,
  scoreDependsOnTime: isScoredSlideType(type),
});

function validateSlides(title: string, slides: PresentationSlide[]): string | null {
  if (!title.trim()) return "Give your presentation deck a title.";
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (!s.question.trim()) return `Slide ${i + 1}: question text is missing.`;
    if (s.type === "select_answer") {
      const filled = s.options.filter((o) => o.text.trim());
      if (filled.length < 2) return `Slide ${i + 1}: needs at least 2 options.`;
      if (!filled.some((o) => o.isCorrect)) return `Slide ${i + 1}: mark a correct option.`;
    } else if (s.type === "type_answer" && s.acceptedAnswers.length === 0) {
      return `Slide ${i + 1}: add at least one accepted answer.`;
    } else if (s.type === "scales" && s.statements.filter((st) => st.trim()).length === 0) {
      return `Slide ${i + 1}: add at least one statement.`;
    } else if (s.type === "ranking" && s.items.filter((it) => it.trim()).length < 2) {
      return `Slide ${i + 1}: ranking needs at least 2 items.`;
    }
  }
  return null;
}

function cleanSlide(s: PresentationSlide): PresentationSlide {
  return {
    ...s,
    question: s.question.trim(),
    options: s.type === "select_answer" ? s.options.filter((o) => o.text.trim()) : [],
    acceptedAnswers: s.type === "type_answer" ? s.acceptedAnswers : [],
    statements: s.type === "scales" ? s.statements.filter((st) => st.trim()) : [],
    minLabel: s.type === "scales" ? s.minLabel : "",
    maxLabel: s.type === "scales" ? s.maxLabel : "",
    items: s.type === "ranking" ? s.items.filter((it) => it.trim()) : [],
    points: isScoredSlideType(s.type) ? s.points : 0,
    scoreDependsOnTime: isScoredSlideType(s.type) ? s.scoreDependsOnTime : false,
  };
}

// Fills gaps instead of rejecting, so an in-progress deck can still be
// persisted as a backend draft (passes the same strict Zod rules as a real
// save) — mirrors the poll builder's save-as-draft normalization.
function normalizeSlideForDraft(s: PresentationSlide): PresentationSlide {
  const cleaned = cleanSlide(s);
  const question = cleaned.question || "Untitled Question";

  let options = cleaned.options;
  if (cleaned.type === "select_answer") {
    options = options.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text);
    while (options.length < 2) {
      options.push({ text: `Option ${options.length + 1}`, isCorrect: false });
    }
    if (!options.some((o) => o.isCorrect)) options[0] = { ...options[0], isCorrect: true };
  }

  let acceptedAnswers = cleaned.acceptedAnswers;
  if (cleaned.type === "type_answer" && acceptedAnswers.length === 0) {
    acceptedAnswers = [question];
  }

  let statements = cleaned.statements;
  if (cleaned.type === "scales" && statements.length === 0) {
    statements = ["Untitled statement"];
  }

  let items = cleaned.items;
  if (cleaned.type === "ranking") {
    items = items.filter((it) => it.trim());
    while (items.length < 2) items.push(`Item ${items.length + 1}`);
  }

  return { ...cleaned, question, options, acceptedAnswers, statements, items };
}

function isSlideDirty(s: PresentationSlide): boolean {
  return Boolean(
    s.question.trim() ||
      s.options.some((o) => o.text.trim()) ||
      s.acceptedAnswers.length > 0 ||
      s.statements.some((st) => st.trim()) ||
      s.items.some((it) => it.trim())
  );
}

function isDeckDirty(title: string, slides: PresentationSlide[]): boolean {
  if (title.trim()) return true;
  return slides.some(isSlideDirty);
}

// AI generation can take a while — if the user is meanwhile adding their own
// slides, applying the AI result must not wipe that work. Keep whatever the
// user actually typed and append the generated slides after it; only replace
// outright when there was nothing but the initial blank placeholder.
function mergeGeneratedSlides(prev: PresentationSlide[], generated: PresentationSlide[]): PresentationSlide[] {
  const meaningful = prev.filter(isSlideDirty);
  return meaningful.length > 0 ? [...meaningful, ...generated] : generated;
}

// Prevents double-creation across remounts/rapid saves during navigation.
let isGlobalCreatingPresentation = false;

export function PresentationBuilder() {
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
  const [acceptedDraft, setAcceptedDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
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
  const activeSlideRef = useRef<HTMLButtonElement | null>(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeSlideRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  useEffect(() => {
    const saved = loadDraft(draftStorageKey);
    if (saved) {
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
  const meta = slideTypeMeta(slide.type);
  const scored = isScoredSlideType(slide.type);

  const patchSlide = (patch: Partial<PresentationSlide>) => {
    setSlides((prev) => prev.map((s, i) => (i === active ? { ...s, ...patch } : s)));
  };

  const addSlide = (type: PresentationSlideType) => {
    setSlides((prev) => [...prev, blankSlide(type)]);
    setActive(slides.length);
    setPickerOpen(false);
  };

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

  const handleAiGenerate = async (params: { topic: string; slideCount: number; slideTypes: PresentationSlideType[] }) => {
    setIsAiGenerating(true);
    const toastId = toast.loading("AI is drafting your slides...");
    try {
      const draft = await generatePresentationDraft(params);
      handleGenerated(draft);
      if (isMountedRef.current) {
        toast.success(`Generated ${draft.slides.length} slides — review and tweak before saving.`, { id: toastId });
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        toast.error(err?.response?.data?.message || "AI deck generation failed.", { id: toastId });
      }
    } finally {
      if (isMountedRef.current) setIsAiGenerating(false);
    }
  };

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (editId === null && !title.trim() && slides.length === 1 && !slides[0]?.question.trim()) {
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

  const draftStateRef = useRef({ title, slides, editId });
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
      const normalized = s.map(normalizeSlideForDraft);
      const payload = {
        title: t.trim() || "Untitled Presentation Deck",
        slides: normalized.map(({ _id, ...rest }) => rest),
      };
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

  const persistAsDraftRef = useRef<((silent: boolean) => Promise<void>) | undefined>(undefined);
  persistAsDraftRef.current = (silent: boolean) => {
    const next = persistQueueRef.current.then(() => runPersistDraft(silent)).catch(() => {});
    persistQueueRef.current = next;
    return next;
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addAcceptedAnswer = () => {
    const value = acceptedDraft.trim();
    if (!value) return;
    if (slide.acceptedAnswers.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setAcceptedDraft("");
      return;
    }
    patchSlide({ acceptedAnswers: [...slide.acceptedAnswers, value] });
    setAcceptedDraft("");
  };

  const handleSave = async () => {
    const cleaned = slides.map(cleanSlide);

    const error = validateSlides(title, cleaned);
    if (error) {
      toast.error(error);
      return;
    }

    setSaving(true);
    isExplicitSaveRef.current = true;
    try {
      const payload = {
        title: title.trim(),
        slides: cleaned.map(({ _id, ...rest }) => rest),
      };
      if (editId) {
        await updatePresentation(editId, payload);
        toast.success("Presentation deck updated!");
      } else {
        await createPresentation(payload);
        toast.success("Presentation deck created!");
      }
      clearDraft(draftStorageKey);
      router.push("/polls");
    } catch (err: any) {
      isExplicitSaveRef.current = false;
      toast.error(err?.response?.data?.message || "Failed to save presentation deck.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-primary/60" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 max-w-6xl mx-auto w-full p-4 sm:p-6 gap-4 sm:gap-6 overflow-hidden">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease }}
        className="flex flex-col md:flex-row md:items-center gap-4 shrink-0"
      >
        <div className="flex-1 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60 flex items-center gap-1.5">
            <PresentationIcon className="size-3.5" /> Presentation Deck Studio
          </p>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled Presentation Deck"
            className="border-none bg-transparent px-0 text-2xl font-bold tracking-tight focus-visible:ring-0 placeholder:text-muted-foreground/30"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            disabled={isAiGenerating}
            onClick={() => setAiOpen(true)}
            className={cn(
              "h-9 rounded-full px-4 text-xs font-semibold transition-all duration-300",
              isAiGenerating
                ? "animate-ai-glow border-primary text-primary"
                : "border-primary/30 text-primary hover:bg-primary/10 hover:shadow-[0_0_15px_rgba(216,173,135,0.3)]"
            )}
          >
            <Sparkles className={cn("size-3.5 mr-1.5 transition-transform duration-200", isAiGenerating && "animate-spin")} />
            {isAiGenerating ? "Generating..." : "AI generate"}
          </Button>
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={savingDraft || saving}
            className="h-9 rounded-full px-4 text-xs font-semibold border-white/15 text-foreground/80 hover:bg-white/5"
          >
            {savingDraft ? <Loader2 className="size-3.5 animate-spin" /> : "Save Draft"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="h-9 rounded-full bg-primary text-primary-foreground text-xs font-semibold px-5 hover:bg-primary/90 shadow-sm"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : editId ? "Save changes" : "Create deck"}
          </Button>
        </div>
      </motion.div>

      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 items-stretch flex-1 min-h-0 overflow-hidden">
        {/* Slide rail */}
        <div className="w-full lg:w-56 shrink-0 flex flex-col rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl h-full min-h-0 overflow-hidden">
          {/* Header */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary/80">Slides</p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {slides.length}
            </span>
          </div>

          {/* Scrollable list of slides */}
          <div className="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto p-2 min-h-0 max-h-[40vh] lg:max-h-none">
            {slides.map((s, i) => {
              const m = slideTypeMeta(s.type);
              return (
                <button
                  key={i}
                  ref={i === active ? activeSlideRef : null}
                  onClick={() => setActive(i)}
                  className={`w-full text-left rounded-2xl border px-3 py-2.5 transition-all duration-300 ${
                    i === active
                      ? "border-primary/40 bg-primary/10 ring-1 ring-yellow-400/30 text-foreground"
                      : "border-white/5 bg-white/3 text-muted-foreground hover:bg-white/6 hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-muted-foreground/50 tabular-nums">
                      {i + 1}
                    </span>
                    <m.Icon className={`size-3 ${m.iconClass}`} />
                    <span className="flex-1 truncate text-xs font-medium">
                      {s.question.trim() || m.label}
                    </span>
                    {slides.length > 1 && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSlides((prev) => prev.filter((_, j) => j !== i));
                          setActive((prev) => Math.max(0, prev > i ? prev - 1 : Math.min(prev, slides.length - 2)));
                        }}
                        className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="size-3" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Pinned Footer */}
          <div className="relative shrink-0 border-t border-white/10 p-2">
            <Button
              variant="outline"
              onClick={() => setPickerOpen((v) => !v)}
              className="w-full rounded-2xl border-dashed border-white/15 bg-transparent text-xs text-muted-foreground/70 hover:text-foreground hover:border-primary/40 hover:bg-primary/5"
            >
              <Plus className="size-3.5 mr-1" /> New slide
            </Button>
            <SlideTypePicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onPick={addSlide}
              position="top"
            />
          </div>
        </div>

        {/* Editor main */}
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
          className="flex-1 min-h-0 flex flex-col p-1.5 rounded-[2rem] bg-white/5 border border-white/10 overflow-hidden h-full"
        >
          <div className="rounded-[1.625rem] bg-card p-5 sm:p-6 space-y-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/4 border border-white/10 px-4 py-2 text-xs font-semibold text-foreground/85">
                <meta.Icon className={`size-3.5 ${meta.iconClass}`} /> {meta.label}
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 ml-1">
                  {scored ? "Scored" : "Interactive"}
                </span>
              </span>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                Slide Question / Title
              </Label>
              <Textarea
                value={slide.question}
                onChange={(e) => patchSlide({ question: e.target.value })}
                placeholder="What statement or question would you like to present?"
                className="min-h-24 rounded-2xl border-white/10 bg-secondary/15 px-4 py-3 text-base font-semibold focus-visible:ring-primary/40 resize-none overflow-hidden [field-sizing:content]"
              />
            </div>

            {/* Per-type editors */}
            {slide.type === "select_answer" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Options — tap the circle to mark correct
                </Label>
                <div className="space-y-2">
                  {slide.options.map((option, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          patchSlide({
                            options: slide.options.map((o, j) =>
                              j === i ? { ...o, isCorrect: !o.isCorrect } : o
                            ),
                          })
                        }
                        title="Mark correct"
                        className="shrink-0"
                      >
                        {option.isCorrect ? (
                          <CheckCircle2 className="size-5 text-emerald-400" />
                        ) : (
                          <Circle className="size-5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors" />
                        )}
                      </button>
                      <Input
                        value={option.text}
                        onChange={(e) =>
                          patchSlide({
                            options: slide.options.map((o, j) =>
                              j === i ? { ...o, text: e.target.value } : o
                            ),
                          })
                        }
                        placeholder={`Option ${i + 1}`}
                        className="h-10 rounded-xl bg-secondary/15 border-border/40"
                      />
                      {slide.options.length > 2 && (
                        <button
                          onClick={() =>
                            patchSlide({ options: slide.options.filter((_, j) => j !== i) })
                          }
                          className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {slide.options.length < 8 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patchSlide({ options: [...slide.options, { text: "", isCorrect: false }] })
                    }
                    className="text-xs text-muted-foreground/70 hover:text-foreground"
                  >
                    <Plus className="size-3.5 mr-1" /> Add option
                  </Button>
                )}
              </div>
            )}

            {slide.type === "type_answer" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Accepted answers (case-insensitive)
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={acceptedDraft}
                    onChange={(e) => setAcceptedDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addAcceptedAnswer();
                      }
                    }}
                    placeholder="Type an answer and press Enter"
                    className="h-10 rounded-xl bg-secondary/15 border-border/40"
                  />
                  <Button variant="outline" onClick={addAcceptedAnswer} className="rounded-xl">
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {slide.acceptedAnswers.map((answer, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400"
                    >
                      {answer}
                      <button
                        onClick={() =>
                          patchSlide({
                            acceptedAnswers: slide.acceptedAnswers.filter((_, j) => j !== i),
                          })
                        }
                        className="hover:text-red-400 transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {slide.type === "wordcloud" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Entries per participant
                </Label>
                <div className="flex gap-2">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => patchSlide({ maxEntries: n })}
                      className={`size-10 rounded-xl border text-sm font-bold transition-all ${
                        slide.maxEntries === n
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-white/10 bg-white/3 text-muted-foreground hover:bg-white/8"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground/50">
                  Repeated words grow bigger in the live cloud.
                </p>
              </div>
            )}

            {slide.type === "open_ended" && (
              <p className="text-xs text-muted-foreground/50 rounded-2xl border border-white/5 bg-white/2 px-4 py-3">
                Participants type a free-form response. Answers show up as a card wall on the
                presenter screen — duplicates are grouped with a counter.
              </p>
            )}

            {slide.type === "scales" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Statements to rate (1–{slide.scaleMax})
                  </Label>
                  <div className="space-y-2">
                    {slide.statements.map((statement, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          value={statement}
                          onChange={(e) =>
                            patchSlide({
                              statements: slide.statements.map((s, j) =>
                                j === i ? e.target.value : s
                              ),
                            })
                          }
                          placeholder={`Statement ${i + 1}`}
                          className="h-10 rounded-xl bg-secondary/15 border-border/40"
                        />
                        {slide.statements.length > 1 && (
                          <button
                            onClick={() =>
                              patchSlide({
                                statements: slide.statements.filter((_, j) => j !== i),
                              })
                            }
                            className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {slide.statements.length < 10 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => patchSlide({ statements: [...slide.statements, ""] })}
                      className="text-xs text-muted-foreground/70 hover:text-foreground"
                    >
                      <Plus className="size-3.5 mr-1" /> Add statement
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Low label
                    </Label>
                    <Input
                      value={slide.minLabel}
                      onChange={(e) => patchSlide({ minLabel: e.target.value })}
                      placeholder="Disagree"
                      className="h-10 rounded-xl bg-secondary/15 border-border/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                      High label
                    </Label>
                    <Input
                      value={slide.maxLabel}
                      onChange={(e) => patchSlide({ maxLabel: e.target.value })}
                      placeholder="Agree"
                      className="h-10 rounded-xl bg-secondary/15 border-border/40"
                    />
                  </div>
                </div>
              </div>
            )}

            {slide.type === "ranking" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Items to rank
                </Label>
                <div className="space-y-2">
                  {slide.items.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-muted-foreground/40 tabular-nums w-4 text-right">
                        {i + 1}
                      </span>
                      <Input
                        value={item}
                        onChange={(e) =>
                          patchSlide({
                            items: slide.items.map((it, j) => (j === i ? e.target.value : it)),
                          })
                        }
                        placeholder={`Item ${i + 1}`}
                        className="h-10 rounded-xl bg-secondary/15 border-border/40"
                      />
                      {slide.items.length > 2 && (
                        <button
                          onClick={() =>
                            patchSlide({ items: slide.items.filter((_, j) => j !== i) })
                          }
                          className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {slide.items.length < 10 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patchSlide({ items: [...slide.items, ""] })}
                    className="text-xs text-muted-foreground/70 hover:text-foreground"
                  >
                    <Plus className="size-3.5 mr-1" /> Add item
                  </Button>
                )}
              </div>
            )}

            {/* Timing & scoring */}
            <div
              className={`grid grid-cols-1 gap-4 pt-2 border-t border-white/5 ${
                scored ? "md:grid-cols-3" : "md:grid-cols-2"
              }`}
            >
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                  <Timer className="size-3.5 text-primary/70" /> Time limit (s)
                </Label>
                <Input
                  type="number"
                  min={5}
                  max={300}
                  value={slide.timeLimit}
                  onChange={(e) =>
                    patchSlide({
                      timeLimit: Math.min(300, Math.max(5, Number(e.target.value) || 5)),
                    })
                  }
                  className="h-10 rounded-xl bg-secondary/15 border-border/40 tabular-nums"
                />
              </div>
              {scored ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                      <Trophy className="size-3.5 text-primary/70" /> Max points
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      step={100}
                      value={slide.points}
                      onChange={(e) =>
                        patchSlide({
                          points: Math.min(10000, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                      className="h-10 rounded-xl bg-secondary/15 border-border/40 tabular-nums"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Faster = more points
                    </Label>
                    <div className="flex items-center gap-3 h-10">
                      <Switch
                        checked={slide.scoreDependsOnTime}
                        onCheckedChange={(checked) => patchSlide({ scoreDependsOnTime: checked })}
                      />
                      <span className="text-xs text-muted-foreground/60">
                        {slide.scoreDependsOnTime
                          ? "Speed bonus on (down to 50%)"
                          : "Flat points for correct"}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Scoring
                  </Label>
                  <p className="text-xs text-muted-foreground/50 h-10 flex items-center">
                    Interactive slide — no points, leaderboard unaffected.
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      <AiPresentationModal
        open={aiOpen}
        onOpenChange={setAiOpen}
        initialTopic={title}
        onGenerated={handleGenerated}
        onGenerate={handleAiGenerate}
        isGenerating={isAiGenerating}
      />
    </div>
  );
}

export const QuizBuilder = PresentationBuilder;

