"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type AiTone } from "@/features/ai/api/generateDraft";
import { cn } from "@/lib/utils";
import BasicDropdown from "@/components/ui/basic-dropdown";
import { Briefcase, Coffee, GraduationCap, Laugh, Sparkles, BarChart2, Target } from "lucide-react";

type Props = {
  children: React.ReactNode;
  isAnonymous: boolean;
  onGenerate: (params: { topic: string; tone: AiTone; questionCount: number; pollType?: 'POLL' | 'TRIAL'; passingScorePercentage?: number }) => void;
  /** Optionally control open state from outside */
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  /** When the dialog opens, seed the topic field (e.g. poll title from the create flow). */
  initialTopic?: string;
  initialPollType?: 'POLL' | 'TRIAL';
  initialPassingScorePercentage?: number;
  isGenerating?: boolean;
};

export function AiPromptModal({
  children,
  onGenerate,
  externalOpen,
  onExternalOpenChange,
  initialTopic,
  initialPollType = 'POLL',
  initialPassingScorePercentage = 70,
  isGenerating,
}: Props) {
  const [open, setOpen] = useState(false);

  // Sync external open state
  const isOpen = externalOpen !== undefined ? externalOpen : open;
  const setIsOpen = (v: boolean) => {
    if (externalOpen !== undefined) {
      onExternalOpenChange?.(v);
    } else {
      setOpen(v);
    }
  };
  const [topic, setTopic] = useState(() => (isOpen && initialTopic?.trim()) || "");
  const [pollType, setPollType] = useState<'POLL' | 'TRIAL'>(initialPollType || 'POLL');
  const [passingScorePercentage, setPassingScorePercentage] = useState(initialPassingScorePercentage);
  const [tone, setTone] = useState<AiTone>("professional & casual");
  const [questionCount, setQuestionCount] = useState(5);

  // Re-seed the form whenever the dialog opens, or its seed props change while
  // it is open (adjusting state during render instead of in an effect).
  const seedSource = { isOpen, initialTopic, initialPollType, initialPassingScorePercentage };
  const [prevSeedSource, setPrevSeedSource] = useState(seedSource);
  if (
    prevSeedSource.isOpen !== isOpen ||
    prevSeedSource.initialTopic !== initialTopic ||
    prevSeedSource.initialPollType !== initialPollType ||
    prevSeedSource.initialPassingScorePercentage !== initialPassingScorePercentage
  ) {
    setPrevSeedSource(seedSource);
    if (isOpen) {
      setPollType(initialPollType || 'POLL');
      if (typeof initialPassingScorePercentage === 'number') {
        setPassingScorePercentage(initialPassingScorePercentage);
      }
      const seed = initialTopic?.trim();
      if (seed) setTopic(seed);
    }
  }

  function handleAction() {
    const trimmed = topic.trim();
    if (trimmed.length < 3) {
      toast.error("Topic should be at least 3 characters.");
      return;
    }
    onGenerate({ topic: trimmed, tone, questionCount, pollType, passingScorePercentage });
    setIsOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate with AI</DialogTitle>
          <DialogDescription>Describe what you want to ask. We shape questions to match your tone and target.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {/* Creation Type Selector */}
          <div className="grid gap-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Type</Label>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-secondary/30 p-1">
              <button
                type="button"
                onClick={() => setPollType("POLL")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all",
                  pollType === "POLL"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <BarChart2 className="size-3.5" />
                <span>Standard Poll</span>
              </button>
              <button
                type="button"
                onClick={() => setPollType("TRIAL")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all",
                  pollType === "TRIAL"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Target className="size-3.5" />
                <span>Assessment Trial</span>
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-topic">Topic</Label>
            <Textarea
              id="ai-topic"
              placeholder={pollType === 'TRIAL' ? "e.g. Social engineering tactics, phishing awareness test..." : "e.g. Quarterly team priorities, favorite frameworks..."}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="min-h-24 rounded-xl"
            />
          </div>

          {pollType === 'TRIAL' && (
            <div className="grid gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ai-pass-threshold" className="text-xs font-semibold text-emerald-400">
                  Passing Score Required
                </Label>
                <span className="text-xs font-bold tabular-nums text-emerald-400">{passingScorePercentage}%</span>
              </div>
              <input
                id="ai-pass-threshold"
                type="range"
                min={10}
                max={100}
                step={5}
                value={passingScorePercentage}
                onChange={(e) => setPassingScorePercentage(Number(e.target.value))}
                className="accent-emerald-500"
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="ai-tone">Tone</Label>
            <BasicDropdown
              items={[
                { id: "professional", label: "Professional", icon: <Briefcase className="size-4" /> },
                { id: "casual", label: "Casual", icon: <Coffee className="size-4" /> },
                { id: "funny", label: "Funny", icon: <Laugh className="size-4" /> },
                { id: "educational", label: "Educational", icon: <GraduationCap className="size-4" /> },
                { id: "professional & casual", label: "Professional & Casual", icon: <Sparkles className="size-4" /> },
              ]}
              label="Select Tone"
              value={tone}
              onChange={(item) => setTone(item.id as AiTone)}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ai-count">Question count</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{questionCount}</span>
            </div>
            <input
              id="ai-count"
              type="range"
              min={1}
              max={10}
              step={1}
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              className="accent-primary"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90"
            disabled={isGenerating}
            onClick={handleAction}
          >
            {isGenerating ? "Generating..." : pollType === 'TRIAL' ? "Generate Trial Questions" : "Generate Poll Questions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
