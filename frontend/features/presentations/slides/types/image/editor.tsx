import { Maximize, Minimize } from "lucide-react";

import { ImagePicker, isHttpsUrl } from "@/features/media/ImagePicker";
import type { ImageContent, ImageFit } from "../../../types/content";
import { blankContentSlide, cleanContentSlide, SegmentedControl, TextField } from "../../content/editorFields";
import { readImage } from "../../content/payloads";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { FieldLabel } from "../../editorKit";
import { meta } from "./meta";

function ImageEditor({ slide, onChange }: SlideEditorProps) {
  const content = readImage(slide.content);
  const set = (patch: Partial<ImageContent>) => onChange({ content: { ...content, ...patch } });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <FieldLabel>Image</FieldLabel>
        <ImagePicker value={{ key: content.key, url: content.url }} onChange={(source) => set(source)} />
      </div>
      <TextField
        label="Alt text"
        required
        multiline
        rows={2}
        value={content.alt}
        onChange={(alt) => set({ alt })}
        maxLength={500}
        placeholder="e.g. Bar chart: revenue doubled from 2024 to 2025"
        hint="Describes the image for people using a screen reader or who can't see it. Required."
      />
      <SegmentedControl<ImageFit>
        label="Fit"
        value={content.fit}
        onChange={(fit) => set({ fit })}
        options={[
          { value: "contain", label: "Show whole image", Icon: Minimize },
          { value: "cover", label: "Fill the frame", Icon: Maximize },
        ]}
      />
      <TextField
        label="Caption"
        value={content.caption}
        onChange={(caption) => set({ caption })}
        maxLength={300}
        placeholder="Optional caption under the image"
      />
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankContentSlide(meta, { key: null, url: null, alt: "", fit: "contain", caption: "" }),
  Editor: ImageEditor,
  validate: (slide) => {
    const { key, url, alt } = readImage(slide.content);
    if (!key && !url) return "choose an image or paste an https link.";
    if (!key && url && !isHttpsUrl(url)) return "image links must start with https://.";
    if (!alt) return "add alt text describing the image.";
    return null;
  },
  clean: (slide) => {
    const content = readImage(slide.content);
    return cleanContentSlide(slide, meta, {
      ...content,
      url: content.url?.trim() || null,
      alt: content.alt.trim(),
      caption: content.caption.trim(),
    });
  },
  // An image slide without a picture saves as a placeholder; alt text is required.
  fillDraft: (slide) => {
    const content = readImage(slide.content);
    return {
      ...slide,
      question: "",
      content: {
        ...content,
        url: content.key || !content.url || isHttpsUrl(content.url) ? content.url : null,
        alt: content.alt || "Image",
      },
    };
  },
};
