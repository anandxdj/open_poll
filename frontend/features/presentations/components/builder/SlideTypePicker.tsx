"use client";

import { Fragment, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { PICKER_SECTIONS, slideMetaInSection } from "../../slides/meta";
import type { PresentationSlideType } from "../../types/deck";

const ease = [0.32, 0.72, 0, 1] as const;

interface SlideTypePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (type: PresentationSlideType) => void;
  position?: "top" | "bottom";
}

/** Mentimeter-style "New slide" panel, one group per picker section. */
export function SlideTypePicker({ open, onClose, onPick, position = "top" }: SlideTypePickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  const posClass = position === "top" ? "bottom-full mb-2 left-0" : "top-full mt-2 left-0";
  const initialY = position === "top" ? -8 : 8;
  const sections = PICKER_SECTIONS.map((section) => ({ ...section, types: slideMetaInSection(section.id) })).filter(
    (section) => section.types.length > 0
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: initialY, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: initialY, scale: 0.98 }}
          transition={{ duration: 0.22, ease }}
          className={cn(
            "absolute z-50 w-80 rounded-3xl border border-border bg-card/95 backdrop-blur-xl p-4 shadow-2xl",
            posClass
          )}
        >
          {sections.map((section, i) => (
            <Fragment key={section.id}>
              {i > 0 && <div className="h-px bg-border my-3" />}
              <div className="flex items-center justify-between mb-3">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  {section.label} <HelpCircle className="size-3 opacity-50" />
                </p>
                {i === 0 && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close slide picker"
                    className="flex size-6 items-center justify-center rounded-lg text-muted-foreground/50 hover:bg-secondary hover:text-foreground transition-all"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {section.types.map(({ type, label, Icon, iconClass }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onPick(type)}
                    className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-secondary/60"
                  >
                    <Icon className={`size-4 shrink-0 ${iconClass}`} />
                    <span className="text-xs font-semibold text-foreground/85">{label}</span>
                  </button>
                ))}
              </div>
            </Fragment>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
