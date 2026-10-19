"use client";

import { Loader2 } from "lucide-react";

import { AiDeckBanner } from "@/features/ai/deck/AiDeckBanner";
import { AiPresentationModal } from "./AiPresentationModal";
import { BuilderHeader } from "./builder/BuilderHeader";
import { BuilderShell } from "./builder/BuilderShell";
import { Inspector } from "./builder/Inspector";
import { SlideRail } from "./builder/SlideRail";
import { useDeckBuilder } from "./builder/useDeckBuilder";

export function PresentationBuilder() {
  const builder = useDeckBuilder();

  if (builder.loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-primary/60" />
      </div>
    );
  }

  return (
    <>
      <BuilderShell
        header={
          <>
            <BuilderHeader
              title={builder.title}
              onTitleChange={builder.setTitle}
              isEditing={Boolean(builder.editId)}
              isAiGenerating={builder.isAiGenerating}
              onOpenAi={() => builder.setAiOpen(true)}
              saving={builder.saving}
              savingDraft={builder.savingDraft}
              onSave={builder.handleSave}
              onSaveDraft={builder.handleSaveDraft}
            />
            <AiDeckBanner />
          </>
        }
        rail={
          <SlideRail
            slides={builder.slides}
            active={builder.active}
            onSelect={builder.setActive}
            onAdd={builder.addSlide}
            onMove={builder.moveSlide}
            onDuplicate={builder.duplicateSlide}
            onRemove={builder.removeSlide}
          />
        }
      >
        <Inspector
          slide={builder.slide}
          index={builder.active}
          onChange={builder.updateSlide}
          deck={builder.deck}
          onDeckChange={builder.updateDeck}
        />
      </BuilderShell>

      <AiPresentationModal
        open={builder.aiOpen}
        onOpenChange={builder.setAiOpen}
        initialTopic={builder.title}
        onGenerated={builder.handleGenerated}
        onGenerate={builder.handleAiGenerate}
        isGenerating={builder.isAiGenerating}
        isEditing={Boolean(builder.editId)}
        onDeckCreated={({ presentation, source }) => builder.handleDeckCreated(presentation, source)}
      />
    </>
  );
}
