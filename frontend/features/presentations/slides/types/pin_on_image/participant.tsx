"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ImageOff, Loader2, MapPin, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { pointerFraction } from "../../advanced/read";
import { MediaPlaceholder } from "../../content/ContentViews";
import type { ParticipantViewProps } from "../../runtime";
import { PinImage } from "./PinImage";
import { moveCursor, percentText, pinAt, pinImageOf, type CursorDirection, type Pin } from "./config";

const ARROWS: Record<string, CursorDirection> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/**
 * Drop one pin on the image: tap (and drag to adjust), or focus the image and
 * move a cursor with the arrow keys (Shift = bigger steps) and press Enter.
 */
export function PinOnImageParticipant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("slidesAdvanced.pinOnImage");
  const tImage = useTranslations("live.slides.image");
  const image = pinImageOf(slide);
  const [pin, setPin] = useState<Pin | null>(null);
  const [cursor, setCursor] = useState<Pin | null>(null);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hintId = useId();
  const locked = submitting || mode === "preview";
  const usable = Boolean(image.url) && !failed;

  const announce = (at: Pin) => setAnnouncement(t("dropped", { x: percentText(at.x), y: percentText(at.y) }));
  const pinFrom = (event: PointerEvent<HTMLDivElement>): Pin | null => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return null;
    const { fx, fy } = pointerFraction(box, event.clientX, event.clientY);
    return pinAt(fx, fy);
  };
  const drop = (at: Pin) => {
    setPin(at);
    setCursor(at);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked || !usable) return;
    const direction = ARROWS[event.key];
    if (direction) {
      event.preventDefault();
      setCursor(moveCursor(cursor ?? pin, direction, event.shiftKey));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const at = cursor ?? { x: 0.5, y: 0.5 };
      drop(at);
      announce(at);
    }
  };

  return (
    <div className="w-full space-y-4">
      {image.url && !failed ? (
        <div
          ref={frameRef}
          tabIndex={locked ? -1 : 0}
          role="group"
          aria-label={t("image", { alt: image.alt })}
          aria-describedby={hintId}
          onPointerDown={(event) => {
            if (locked) return;
            const at = pinFrom(event);
            if (!at) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragging.current = true;
            drop(at);
          }}
          onPointerMove={(event) => {
            const at = dragging.current ? pinFrom(event) : null;
            if (at) drop(at);
          }}
          onPointerUp={() => {
            dragging.current = false;
            if (pin) announce(pin);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "relative mx-auto w-fit max-w-full touch-none select-none overflow-hidden rounded-2xl border border-deck-border outline-none focus-visible:ring-2 focus-visible:ring-deck-primary/60",
            locked ? "opacity-80" : "cursor-crosshair"
          )}
        >
          <PinImage
            url={image.url}
            alt=""
            className="pointer-events-none block max-h-[65vh] w-auto max-w-full"
            onFail={() => setFailed(true)}
          />
          {cursor && (!pin || cursor.x !== pin.x || cursor.y !== pin.y) && (
            <span
              aria-hidden
              className="pointer-events-none absolute size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-deck-primary bg-deck-primary/10"
              style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
            />
          )}
          {pin && (
            <MapPin
              aria-hidden
              data-testid="pin"
              className="pointer-events-none absolute size-9 -translate-x-1/2 -translate-y-full fill-deck-primary text-deck-primary-fg drop-shadow-md"
              style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
            />
          )}
        </div>
      ) : (
        <MediaPlaceholder
          Icon={ImageOff}
          label={image.url ? tImage("unavailable") : tImage("missing")}
          tone="device"
          className="h-56 w-full"
        />
      )}

      <p id={hintId} className="text-center text-xs text-deck-muted-fg">
        {pin ? t("hintMove") : t("hintDrop")}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <Button
        onClick={() => pin && onSubmit({ payload: { x: pin.x, y: pin.y } })}
        disabled={locked || !pin || !usable}
        className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            {t("submit")} <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
