"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { AiDeckBanner } from "@/features/ai/deck/AiDeckBanner";
import { EmbedDialog } from "@/features/embeds/components/EmbedDialog";
import { useCanEmbedDecks } from "@/features/embeds/useCanEmbed";
import { ImportQuestionsDialog } from "@/features/imports";
import { blankSlide } from "../slides/editor";
import type { PresentationSlide, PresentationSlideType } from "../types/deck";
import { AiPresentationModal } from "./AiPresentationModal";
import { BuilderHeader } from "./builder/BuilderHeader";
import { BuilderShell } from "./builder/BuilderShell";
import { ConflictBanner } from "./builder/ConflictBanner";
import { isSlideDirty } from "./builder/deckDraft";
import { Inspector } from "./builder/Inspector";
import { SlideRail } from "./builder/SlideRail";
import { SlideStage } from "./builder/SlideStage";
import { useDeckBuilder } from "./builder/useDeckBuilder";
import { PresenceAvatars } from "./builder/PresenceAvatars";
import { useDeckPresence } from "./builder/useDeckPresence";
import { TemplateNotice } from "@/features/templates/components/TemplateNotice";
import { deckThemeFrom } from "@/features/themes/deckTheme";

export function PresentationBuilder() {
  const builder = useDeckBuilder();
  const [importOpen, setImportOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const canEmbed = useCanEmbedDecks();
  const presence = useDeckPresence(builder.isTemplate ? null : builder.editId);
  // The canvas and the thumbnails draw the deck as the room will see it: its resolved theme, or
  // for a deck not saved yet the built-in look in the creator's light or dark.
  const canvasTheme = deckThemeFrom(builder.deck.themeTokens) ?? { mode: builder.deck.theme?.mode ?? builder.appMode };

  if (builder.loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // A workspace template (direct link): offered as a template, not edited.
  if (builder.isTemplate && builder.editId) {
    return <TemplateNotice templateId={builder.editId} title={builder.title} />;
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
              onImportQuestions={() => setImportOpen(true)}
              saving={builder.saving}
              savingDraft={builder.savingDraft}
              onSave={() => void builder.handleSave()}
              onSaveDraft={builder.handleSaveDraft}
              onPresent={() => void builder.handleSave("present")}
              // Templates are not presented, so not embedded either.
              onEmbed={canEmbed && !builder.isTemplate ? () => setEmbedOpen(true) : undefined}
              presence={<PresenceAvatars presence={presence} />}
            />
            {builder.conflict ? (
              <ConflictBanner
                busy={builder.resolvingConflict}
                onReload={() => void builder.reloadLatest()}
                onSaveCopy={() => void builder.saveMineAsCopy()}
              />
            ) : null}
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
            theme={canvasTheme}
          />
        }
        stage={
          <SlideStage
            slide={builder.slide}
            index={builder.active}
            total={builder.slides.length}
            onChange={builder.updateSlide}
            theme={canvasTheme}
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

      {builder.editId && embedOpen ? (
        <EmbedDialog open onOpenChange={setEmbedOpen} presentationId={builder.editId} title={builder.title} />
      ) : null}

      <ImportQuestionsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        // A deck holds 50 slides; the untouched starter slide is replaced by the first import.
        room={Math.max(0, 50 - builder.slides.filter(isSlideDirty).length)}
        onAdd={(slides) => {
          // The server already checked these with the slide registry's schema, the rules the builder follows.
          const imported = slides.map(
            (slide) => ({ ...blankSlide(slide.type as PresentationSlideType), ...slide }) as unknown as PresentationSlide
          );
          builder.handleGenerated({ title: "", slides: imported });
        }}
      />
    </>
  );
}
