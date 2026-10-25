"use client";

import { useId, useRef, useState, type PointerEvent } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImagePicker, isHttpsUrl } from "@/features/media/ImagePicker";
import { RemoteImage } from "@/features/media/RemoteImage";
import type { PinImageContent } from "../../../types/deck";
import { GRADED_POINTS, GradedSwitch, IssueNote, NumberField } from "../../advanced/editorFields";
import { pointerFraction, roundTo } from "../../advanced/read";
import { TextField } from "../../content/editorFields";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { blankBase, cleanBase, EditorNote, FieldLabel, requireQuestion } from "../../editorKit";
import {
  MIN_REGION_SIZE,
  pinAt,
  pinImageOf,
  rawRegion,
  regionBetween,
  regionIssue,
  roundRegion,
  type Pin,
  type PinRegion,
} from "./config";
import { meta } from "./meta";

/** Seconds a graded slide needs (speed scoring needs a deadline). */
const MIN_GRADED_TIMER = 5;
/** The area a first numeric edit starts from. */
const STARTER_REGION: PinRegion = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };

const percent = (fraction: number) => roundTo(fraction * 100, 2);

/** Draw the correct area on the image by dragging, or type its edges. */
function RegionEditor({
  image,
  region,
  onChange,
}: {
  image: PinImageContent;
  region: PinRegion | null;
  onChange: (region: PinRegion | null) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<Pin | null>(null);
  const [drawing, setDrawing] = useState<PinRegion | null>(null);
  const hintId = useId();
  const shown = drawing ?? region;

  const pinOf = (event: PointerEvent<HTMLDivElement>): Pin => {
    const box = frameRef.current?.getBoundingClientRect();
    const { fx, fy } = box ? pointerFraction(box, event.clientX, event.clientY) : { fx: 0.5, fy: 0.5 };
    return pinAt(fx, fy);
  };

  const edit = (patch: Partial<PinRegion>) => onChange(roundRegion({ ...(region ?? STARTER_REGION), ...patch }));

  return (
    <div className="space-y-3">
      <FieldLabel>Correct area</FieldLabel>
      {image.url ? (
        <div
          ref={frameRef}
          role="img"
          aria-label={image.alt || "Image"}
          aria-describedby={hintId}
          className="relative w-fit max-w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl border border-border/40"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            anchor.current = pinOf(event);
          }}
          onPointerMove={(event) => {
            if (anchor.current) setDrawing(regionBetween(anchor.current, pinOf(event)));
          }}
          onPointerUp={(event) => {
            const start = anchor.current;
            anchor.current = null;
            setDrawing(null);
            if (!start) return;
            const drawn = regionBetween(start, pinOf(event));
            // A plain click (no real drag) keeps the area as it was.
            if (drawn.width >= MIN_REGION_SIZE && drawn.height >= MIN_REGION_SIZE) onChange(drawn);
          }}
          onPointerCancel={() => {
            anchor.current = null;
            setDrawing(null);
          }}
        >
          <RemoteImage
            src={image.url}
            alt=""
            className="pointer-events-none block max-h-72 w-auto max-w-full"
            fallback={<p className="p-6 text-xs text-muted-foreground/70">This image could not be loaded.</p>}
          />
          {shown && (
            <span
              aria-hidden
              className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/25"
              style={{
                left: `${shown.x * 100}%`,
                top: `${shown.y * 100}%`,
                width: `${shown.width * 100}%`,
                height: `${shown.height * 100}%`,
              }}
            />
          )}
        </div>
      ) : (
        <EditorNote>Choose an image first, then mark the correct area on it.</EditorNote>
      )}
      <p id={hintId} className="text-[11px] text-muted-foreground/60">
        Drag on the image to mark the area, or type its edges as a percentage of the image. Pins inside it are correct.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField
          label="Left (%)"
          value={region ? percent(region.x) : null}
          min={0}
          max={100}
          onChange={(v) => edit({ x: v / 100 })}
        />
        <NumberField
          label="Top (%)"
          value={region ? percent(region.y) : null}
          min={0}
          max={100}
          onChange={(v) => edit({ y: v / 100 })}
        />
        <NumberField
          label="Width (%)"
          value={region ? percent(region.width) : null}
          min={0}
          max={100}
          onChange={(v) => edit({ width: v / 100 })}
        />
        <NumberField
          label="Height (%)"
          value={region ? percent(region.height) : null}
          min={0}
          max={100}
          onChange={(v) => edit({ height: v / 100 })}
        />
      </div>
      {region && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(null)}
          className="text-xs text-muted-foreground/70 hover:text-foreground"
        >
          <Trash2 className="size-3.5 mr-1" /> Clear area
        </Button>
      )}
    </div>
  );
}

function PinOnImageEditor({ slide, onChange }: SlideEditorProps) {
  const image = pinImageOf(slide);
  const region = rawRegion(slide);
  const graded = slide.points > 0;
  const setImage = (patch: Partial<PinImageContent>) => onChange({ content: { ...image, ...patch } });

  const setGraded = (next: boolean) => {
    if (!next) {
      // The area stays while editing (switching back restores it); `clean` drops it on save.
      onChange({ points: 0, scoreDependsOnTime: false });
      return;
    }
    onChange({
      points: GRADED_POINTS,
      scoreDependsOnTime: true,
      timeLimit: slide.timeLimit >= MIN_GRADED_TIMER ? slide.timeLimit : 30,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <FieldLabel>Image</FieldLabel>
        <ImagePicker value={{ key: image.key, url: image.url }} onChange={(source) => setImage(source)} />
      </div>
      <TextField
        label="Alt text"
        required
        multiline
        rows={2}
        value={image.alt}
        onChange={(alt) => setImage({ alt })}
        maxLength={500}
        placeholder="e.g. Map of France with its regions"
        hint="Describes the image for people using a screen reader or who can't see it. Required."
      />

      <GradedSwitch
        graded={graded}
        onChange={setGraded}
        hintOn="Pins inside the correct area score points"
        hintOff="Results only — no correct area, no points"
      />
      {graded && (
        <>
          <RegionEditor image={image} region={region} onChange={(next) => onChange({ config: { region: next } })} />
          <IssueNote issue={region ? regionIssue(region) : null} />
        </>
      )}

      <EditorNote>
        Participants tap the image to drop one pin (or move a cursor with the arrow keys and press Enter). The stage
        shows every pin and a heatmap once you reveal the results.
      </EditorNote>
    </div>
  );
}

const cleanImage = (slide: object): PinImageContent => {
  const image = pinImageOf(slide);
  return { key: image.key, url: image.url?.trim() || null, alt: image.alt.trim() };
};

export const editor: SlideEditorDef = {
  meta,
  // Ungraded until the author turns grading on and marks a correct area.
  blank: () => ({
    ...blankBase(meta),
    points: 0,
    scoreDependsOnTime: false,
    content: { key: null, url: null, alt: "" },
    config: { region: null },
  }),
  Editor: PinOnImageEditor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    const { key, url, alt } = pinImageOf(slide);
    if (!key && !url) return "choose an image or paste an https link.";
    if (!key && url && !isHttpsUrl(url)) return "image links must start with https://.";
    if (!alt) return "add alt text describing the image.";
    if (slide.points > 0) {
      const region = rawRegion(slide);
      if (!region) return "draw the correct area on the image, or turn grading off.";
      const issue = regionIssue(region);
      if (issue) return issue;
      if (slide.timeLimit < MIN_GRADED_TIMER) {
        return `scored slides need a timer of at least ${MIN_GRADED_TIMER} seconds.`;
      }
    }
    return null;
  },
  clean: (slide) => {
    const graded = slide.points > 0;
    const region = rawRegion(slide);
    return {
      ...cleanBase(slide, meta),
      points: graded ? slide.points : 0,
      scoreDependsOnTime: graded ? slide.scoreDependsOnTime : false,
      content: cleanImage(slide),
      // An ungraded slide has no correct area: a 0-point slide shows results only.
      config: { region: graded && region ? roundRegion(region) : null },
    };
  },
  // An image slide without a picture saves as a placeholder in drafts; alt text is required.
  fillDraft: (slide) => {
    const image = cleanImage(slide);
    const raw = rawRegion(slide);
    const region = raw ? roundRegion(raw) : null;
    const usable = region !== null && regionIssue(region) === null;
    const needsTimer = usable && slide.points > 0 && slide.timeLimit < MIN_GRADED_TIMER;
    return {
      ...slide,
      content: {
        ...image,
        url: image.key || !image.url || isHttpsUrl(image.url) ? image.url : null,
        alt: image.alt || "Image",
      },
      config: { region: usable ? region : null },
      ...(needsTimer ? { timeLimit: 30 } : {}),
    };
  },
};
