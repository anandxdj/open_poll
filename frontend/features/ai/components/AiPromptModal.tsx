"use client";

import { useEffect, useState } from "react";
import axios from "axios";
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
import {
  AI_TONES,
  type AiTone,
  type GeneratedPollDraft,
  defaultAiExpiresAtIso,
  generateDraft,
} from "@/features/ai/api/generateDraft";
import { cn } from "@/lib/utils";
import BasicDropdown from "@/components/ui/basic-dropdown";
import { Briefcase, Coffee, GraduationCap, Laugh, Sparkles } from "lucide-react";

type Props = {
  children: React.ReactNode;
  isAnonymous: boolean;
  onGenerate: (params: { topic: string; tone: AiTone; questionCount: number }) => void;
  /** Optionally control open state from outside */
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  /** When the dialog opens, seed the topic field (e.g. poll title from the create flow). */
  initialTopic?: string;
  isGenerating?: boolean;
};

export function AiPromptModal({
  children,
  onGenerate,
  externalOpen,
  onExternalOpenChange,
  initialTopic,
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
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<AiTone>("professional & casual");
  const [questionCount, setQuestionCount] = useState(5);

  useEffect(() => {
    if (!isOpen) return;
    const seed = initialTopic?.trim();
    if (!seed) return;
    void Promise.resolve().then(() => {
      setTopic(seed);
    });
  }, [isOpen, initialTopic]);

  function handleAction() {
    const trimmed = topic.trim();
    if (trimmed.length < 3) {
      toast.error("Topic should be at least 3 characters.");
      return;
    }
    onGenerate({ topic: trimmed, tone, questionCount });
    setIsOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate with AI</DialogTitle>
          <DialogDescription>Describe what you want to ask. We shape questions to match your tone.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ai-topic">Topic</Label>
            <Textarea
              id="ai-topic"
              placeholder="e.g. Quarterly team priorities, favorite frameworks for side projects…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="min-h-28 rounded-xl"
            />
          </div>
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
            {isGenerating ? "Busy..." : "Generate questions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
