"use client";

import { useEffect } from "react";

import { AiDeckForm } from "./AiDeckForm";
import { AiDeckOutline } from "./AiDeckOutline";
import { AiDeckPlanning, AiDeckWriting } from "./AiDeckProgress";
import { AiDeckResult } from "./AiDeckResult";
import { AiIntlProvider } from "./AiIntlProvider";
import { countSlides } from "./outline";
import { isBusy } from "./state";
import { useAiAvailable } from "./useAiCapability";
import { useAiDeck } from "./useAiDeck";
import type { DeckCreatedResponse } from "./types";

export interface AiDeckPanelProps {
  /** Seeds the topic field. */
  initialTopic?: string;
  /** The name the author already gave the deck; it becomes the outline's title. */
  deckTitle?: string;
  /** The deck exists: send the author to it. */
  onOpenDeck: (response: DeckCreatedResponse) => void;
  /** Close the host dialog without generating. */
  onCancel: () => void;
  /** Called when a request starts or ends, so the host can lock its dismiss controls. */
  onBusyChange?: (busy: boolean) => void;
}

function Panel({ initialTopic, deckTitle, onOpenDeck, onCancel, onBusyChange }: AiDeckPanelProps) {
  const { state, dispatch, plan, cancelPlan, write } = useAiDeck({ initialTopic, deckTitle });
  const aiAvailable = useAiAvailable();
  const busy = isBusy(state);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  switch (state.phase) {
    case "planning":
      return <AiDeckPlanning onCancel={cancelPlan} />;
    case "writing":
      return <AiDeckWriting slideCount={state.outline ? countSlides(state.outline) : state.form.slideCount} />;
    case "outline":
      return state.outline ? (
        <AiDeckOutline
          outline={state.outline}
          kinds={state.kinds}
          include={state.form.include}
          source={state.outlineSource}
          warnings={state.outlineWarnings}
          error={state.error}
          onChange={(outline) => dispatch({ type: "edit-outline", outline })}
          onBack={() => dispatch({ type: "back-to-form" })}
          onSubmit={() => void write()}
        />
      ) : null;
    case "done":
      return state.result ? (
        <AiDeckResult
          result={state.result}
          onOpen={() => onOpenDeck(state.result!)}
          onAnother={() => dispatch({ type: "reset" })}
        />
      ) : null;
    case "form":
      return (
        <AiDeckForm
          form={state.form}
          error={state.error}
          aiAvailable={aiAvailable}
          onChange={(patch) => dispatch({ type: "edit-form", patch })}
          onSubmit={() => void plan()}
          onCancel={onCancel}
        />
      );
  }
}

/** The whole-deck flow (form, outline review, writing, result), for the AI dialog and its tests. */
export function AiDeckPanel(props: AiDeckPanelProps) {
  return (
    <AiIntlProvider>
      <Panel {...props} />
    </AiIntlProvider>
  );
}
