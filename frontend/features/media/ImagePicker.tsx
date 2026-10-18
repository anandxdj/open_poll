"use client";

import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ImageIcon, ImageOff, Link2, Loader2, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useStorageAvailable } from "./capabilities";
import { RemoteImage } from "./RemoteImage";
import { UPLOAD_RULES, useUpload } from "./useUpload";

/** Where an image comes from: an upload (`key`, with its storage `url`) or a pasted https `url`. */
export interface ImageSource {
  key: string | null;
  url: string | null;
}

export const isHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
};

const ACCEPT = UPLOAD_RULES.slide_image.types.join(",");

/**
 * Picks the image of a slide. With storage configured (`capabilities.storage`)
 * the file is uploaded (presign → PUT → complete) and the slide keeps its key;
 * a pasted https link works either way. Without storage only the link is
 * offered, with a short explanation. Builder-only.
 */
export function ImagePicker({
  value,
  onChange,
  label = "Image",
}: {
  value: ImageSource;
  onChange: (next: ImageSource) => void;
  label?: string;
}) {
  const { storage, loading } = useStorageAvailable();
  const upload = useUpload("slide_image");
  const fileRef = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const hintId = useId();
  const pastedUrl = value.key ? "" : (value.url ?? "");
  const [link, setLink] = useState(pastedUrl);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // The builder reuses this picker when another image slide is selected:
  // follow the new value instead of keeping the previous slide's draft.
  const [shownUrl, setShownUrl] = useState(pastedUrl);
  if (shownUrl !== pastedUrl) {
    setShownUrl(pastedUrl);
    setLink(pastedUrl);
    setLinkError(null);
  }

  const commitLink = () => {
    const next = link.trim();
    if (!next) {
      setLinkError(null);
      if (!value.key && value.url) onChange({ key: null, url: null });
      return;
    }
    if (!isHttpsUrl(next)) {
      setLinkError("Use a link that starts with https://");
      return;
    }
    setLinkError(null);
    if (next !== value.url || value.key) onChange({ key: null, url: next });
  };

  const onLinkKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitLink();
    }
  };

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    const media = await upload.upload(file);
    if (media) {
      setLink("");
      setLinkError(null);
      onChange({ key: media.key, url: media.url });
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (storage && !upload.uploading) void uploadFile(event.dataTransfer.files[0]);
  };

  const clear = () => {
    setLink("");
    setLinkError(null);
    upload.reset();
    onChange({ key: null, url: null });
  };

  return (
    <div className="space-y-3">
      {value.url ? (
        <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-secondary/15">
          <RemoteImage
            src={value.url}
            alt=""
            className="h-44 w-full object-contain"
            fallback={
              <div className="flex h-44 flex-col items-center justify-center gap-2 text-xs text-muted-foreground/70">
                <ImageOff className="size-6" aria-hidden /> This image could not be loaded.
              </div>
            }
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={clear}
            className="absolute right-2 top-2 h-7 rounded-full text-xs"
          >
            <Trash2 className="size-3.5" /> Remove
          </Button>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            if (!storage) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-primary/60 bg-primary/5" : "border-border/60 bg-secondary/10"
          )}
        >
          <ImageIcon className="size-6 text-muted-foreground/50" aria-hidden />
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground/60" aria-label="Checking upload support" />
          ) : storage ? (
            <>
              <p className="text-xs text-muted-foreground/70">Drop an image here, or</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={upload.uploading}
                className="rounded-full text-xs"
              >
                <Upload className="size-3.5" /> Upload {label.toLowerCase()}
              </Button>
              <p className="text-[11px] text-muted-foreground/50">PNG, JPG, GIF, WebP or AVIF, up to 10 MB</p>
            </>
          ) : (
            <p id={hintId} className="max-w-xs text-xs text-muted-foreground/70">
              File uploads aren&apos;t set up on this server, so paste a link to an image hosted elsewhere. It must
              start with https://.
            </p>
          )}
        </div>
      )}

      {upload.uploading && (
        <div className="flex items-center gap-3" role="status">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.round(upload.progress * 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(upload.progress * 100)}%</span>
          <button
            type="button"
            onClick={upload.cancel}
            aria-label="Cancel upload"
            className="text-muted-foreground/60 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {upload.error && (
        <p className="text-xs text-red-400" role="alert">
          {upload.error}
        </p>
      )}

      {storage && (
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            void uploadFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      )}

      <div className="space-y-1.5">
        <label htmlFor={linkId} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
          <Link2 className="size-3.5" aria-hidden /> {storage ? "Or paste an image link" : "Image link"}
        </label>
        <Input
          id={linkId}
          type="url"
          inputMode="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          onBlur={commitLink}
          onKeyDown={onLinkKeyDown}
          placeholder="https://…"
          aria-invalid={linkError ? true : undefined}
          aria-describedby={!value.url && !storage && !loading ? hintId : undefined}
          className="h-10 rounded-xl bg-secondary/15 border-border/40"
        />
        {linkError && (
          <p className="text-xs text-red-400" role="alert">
            {linkError}
          </p>
        )}
      </div>
    </div>
  );
}
