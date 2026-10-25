"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { FileUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A drop zone with a real file input behind it (keyboard and screen-reader
 * users get the input's own behaviour). `label` names the zone; `selected`
 * replaces it once a file is chosen.
 */
export function FilePicker({
  accept,
  label,
  selected,
  onFile,
  disabled = false,
  error,
}: {
  accept: string;
  label: string;
  selected?: string | null;
  onFile: (file: File) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center text-sm transition-colors focus-within:ring-2 focus-within:ring-primary/40",
          dragging ? "border-primary bg-primary/5" : "border-border bg-secondary/20 hover:border-primary/40",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <FileUp className="size-6 text-primary/70" aria-hidden />
        <span className="font-medium text-foreground/90">{selected ?? label}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          disabled={disabled}
          aria-describedby={error ? errorId : undefined}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            // Choosing the same file again must fire a change.
            event.target.value = "";
          }}
        />
      </label>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
