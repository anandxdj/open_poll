"use client";

import { Fragment, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

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
            "absolute z-50 w-80 rounded-xl border border-border bg-popover p-3 shadow-lg shadow-black/10",
            posClass
          )}
        >
          {sections.map((section, i) => (
            <Fragment key={section.id}>
              {i > 0 && <div className="my-2 h-px bg-border" />}
              <div className="mb-1 flex items-center justify-between">
                <p className="px-1 text-xs font-medium text-muted-foreground">{section.label}</p>
                {i === 0 && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close slide picker"
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {section.types.map(({ type, label, Icon }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onPick(type)}
                    className="group flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-accent-ink" />
                    <span className="text-sm text-foreground">{label}</span>
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
