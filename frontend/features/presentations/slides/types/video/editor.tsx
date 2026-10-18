"use client";

import { useId, useRef, useState } from "react";
import { FileVideo, Link2, Loader2, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCapabilities } from "@/features/media/capabilities";
import { UPLOAD_RULES, useUpload } from "@/features/media/useUpload";
import { canEmbed, VideoEmbed } from "@/features/media/VideoEmbed";
import { formatStart, isVideoId, parseStart, parseVideoLink, watchUrl } from "@/features/media/video";
import type { VideoContent } from "../../../types/content";
import { blankContentSlide, cleanContentSlide, SegmentedControl } from "../../content/editorFields";
import { readVideo } from "../../content/payloads";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { entryInputClass } from "../../editorKit";
import { meta } from "./meta";

type Source = "link" | "file";

const labelClass = "text-xs font-semibold uppercase tracking-wider text-muted-foreground/60";

/** The link field shows what was pasted; the slide keeps only the parsed id. */
function VideoLinkField({ video, onChange }: { video: VideoContent; onChange: (patch: Partial<VideoContent>) => void }) {
  const id = useId();
  const linked = video.provider !== "file" && video.id ? watchUrl(video.provider, video.id) : "";
  const [draft, setDraft] = useState(linked);
  // Another slide selected (or the id changed elsewhere): show its link.
  const [shown, setShown] = useState(linked);
  if (shown !== linked) {
    setShown(linked);
    if ((parseVideoLink(draft)?.id ?? null) !== video.id) setDraft(linked);
  }
  const invalid = draft.trim() !== "" && parseVideoLink(draft) === null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={labelClass}>
        YouTube or Vimeo link
        <span className="text-primary/80" aria-hidden>
          *
        </span>
      </Label>
      <Input
        id={id}
        type="url"
        inputMode="url"
        required
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseVideoLink(e.target.value);
          if (parsed) onChange({ provider: parsed.provider, id: parsed.id, start: parsed.start ?? video.start });
          else if (video.id) onChange({ id: null });
        }}
        placeholder="https://www.youtube.com/watch?v=…"
        aria-invalid={invalid || undefined}
        className={entryInputClass}
      />
      {invalid ? (
        <p className="text-xs text-red-400" role="alert">
          That isn&apos;t a YouTube or Vimeo video link.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground/60">
          Plays through youtube-nocookie.com or player.vimeo.com. A start time in the link (t=…) is kept.
        </p>
      )}
    </div>
  );
}

/** Upload an mp4/webm to storage; the slide keeps its key. */
function VideoUploadField({ video, onChange }: { video: VideoContent; onChange: (patch: Partial<VideoContent>) => void }) {
  const upload = useUpload("slide_video");
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <p className={labelClass}>Video file</p>
      {video.key ? (
        <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-secondary/15 px-3 py-2 text-xs">
          <FileVideo className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate text-muted-foreground">{video.key.split("/").pop()}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ key: null, url: null })}
            className="h-7 text-xs"
          >
            <Trash2 className="size-3.5" /> Remove
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={upload.uploading}
          onClick={() => fileRef.current?.click()}
          className="rounded-full text-xs"
        >
          {upload.uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload
          video (MP4 or WebM, up to 200 MB)
        </Button>
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
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_RULES.slide_video.types.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const media = await upload.upload(file);
          if (media) onChange({ provider: "file", id: null, key: media.key, url: media.url });
        }}
      />
    </div>
  );
}

function StartField({ start, onChange }: { start: number; onChange: (start: number) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(start > 0 ? formatStart(start) : "");
  const [shown, setShown] = useState(start);
  if (shown !== start) {
    setShown(start);
    if ((parseStart(draft) ?? 0) !== start) setDraft(start > 0 ? formatStart(start) : "");
  }
  const invalid = draft.trim() !== "" && parseStart(draft) === null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={labelClass}>
        Start at
      </Label>
      <Input
        id={id}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const seconds = parseStart(e.target.value);
          onChange(seconds ?? 0);
        }}
        placeholder="0:00"
        aria-invalid={invalid || undefined}
        className={`${entryInputClass} max-w-32 tabular-nums`}
      />
      {invalid && (
        <p className="text-xs text-red-400" role="alert">
          Use minutes:seconds (1:30) or seconds (90).
        </p>
      )}
    </div>
  );
}

function VideoEditor({ slide, onChange }: SlideEditorProps) {
  const video = readVideo(slide.content);
  const { capabilities } = useCapabilities();
  const storage = capabilities?.storage === true;
  const set = (patch: Partial<VideoContent>) => onChange({ content: { ...video, ...patch } });
  const source: Source = video.provider === "file" ? "file" : "link";

  return (
    <div className="space-y-5">
      <SegmentedControl<Source>
        label="Source"
        value={source}
        onChange={(next) =>
          set(next === "file" ? { provider: "file", id: null } : { provider: "youtube", key: null, url: null })
        }
        options={[
          { value: "link", label: "YouTube or Vimeo", Icon: Link2 },
          { value: "file", label: "Uploaded file", Icon: Upload, disabled: !storage && source !== "file" },
        ]}
      />
      {!storage && source === "link" && (
        <p className="text-[11px] text-muted-foreground/60">
          Uploading video files needs file storage, which isn&apos;t set up on this server.
        </p>
      )}

      {source === "link" ? <VideoLinkField video={video} onChange={set} /> : <VideoUploadField video={video} onChange={set} />}

      <StartField start={video.start} onChange={(start) => set({ start })} />

      {canEmbed(video) && (
        <div className="aspect-video overflow-hidden rounded-2xl border border-border/40">
          <VideoEmbed video={video} title="Video preview" />
        </div>
      )}
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankContentSlide(meta, { provider: "youtube", id: null, key: null, url: null, start: 0 }),
  Editor: VideoEditor,
  validate: (slide) => {
    const video = readVideo(slide.content);
    if (video.provider === "file") return video.key ? null : "upload a video file.";
    return video.id ? null : "paste a YouTube or Vimeo link.";
  },
  clean: (slide) => {
    const video = readVideo(slide.content);
    return cleanContentSlide(
      slide,
      meta,
      video.provider === "file"
        ? { ...video, id: null }
        : { ...video, key: null, url: null, id: video.id && isVideoId(video.provider, video.id) ? video.id : null }
    );
  },
  fillDraft: (slide) => ({ ...slide, question: "" }),
};
