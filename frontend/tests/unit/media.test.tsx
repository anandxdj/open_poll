import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { isHttpsUrl } from "@/features/media/ImagePicker";
import { checkUploadFile } from "@/features/media/useUpload";
import { canEmbed, VideoEmbed } from "@/features/media/VideoEmbed";
import { embedUrl, formatStart, parseStart, parseVideoLink } from "@/features/media/video";
import { buildCsp, CSP_DIRECTIVES, storageOrigins } from "@/lib/security/headers";

describe("video links", () => {
  test("reads YouTube links in their common shapes", () => {
    const id = "dQw4w9WgXcQ";
    for (const link of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&list=PL123`,
      `https://m.youtube.com/watch?v=${id}`,
      `youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      id,
    ]) {
      expect(parseVideoLink(link)).toEqual({ provider: "youtube", id, start: null });
    }
    expect(parseVideoLink(`https://youtu.be/${id}?t=90`)).toEqual({ provider: "youtube", id, start: 90 });
    expect(parseVideoLink(`https://www.youtube.com/watch?v=${id}&t=1m30s`)?.start).toBe(90);
    expect(parseVideoLink(`https://www.youtube.com/embed/${id}?start=42`)?.start).toBe(42);
  });

  test("reads Vimeo links", () => {
    for (const link of [
      "https://vimeo.com/76979871",
      "https://player.vimeo.com/video/76979871",
      "https://vimeo.com/channels/staffpicks/76979871",
      "76979871",
    ]) {
      expect(parseVideoLink(link)).toEqual({ provider: "vimeo", id: "76979871", start: null });
    }
    expect(parseVideoLink("https://vimeo.com/76979871#t=2m")?.start).toBe(120);
  });

  test("refuses anything else", () => {
    for (const link of [
      "",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ%22%3E%3Cscript%3E",
      "https://www.youtube.com/@channel",
      "javascript:alert(1)//youtu.be/dQw4w9WgXcQ",
      "https://vimeo.com/about",
      "https://evil.example/youtu.be/dQw4w9WgXcQ",
      "dQw4w9WgX<Q",
    ]) {
      expect(parseVideoLink(link)).toBeNull();
    }
  });

  test("start times", () => {
    expect([parseStart("90"), parseStart("90s"), parseStart("1:30"), parseStart("1m30s"), parseStart("1:02:03")]).toEqual([
      90, 90, 90, 90, 3723,
    ]);
    expect([parseStart(""), parseStart("abc"), parseStart("-5"), parseStart("25:00:00")]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect([formatStart(0), formatStart(90), formatStart(3723)]).toEqual(["0:00", "1:30", "1:02:03"]);
  });

  test("embeds through the privacy-enhanced players", () => {
    expect(embedUrl("youtube", "dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
    expect(embedUrl("youtube", "dQw4w9WgXcQ", 42)).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=42"
    );
    expect(embedUrl("vimeo", "76979871", 42)).toBe("https://player.vimeo.com/video/76979871?dnt=1#t=42s");
  });

  test("VideoEmbed plays only valid ids, uploads only with a URL, always with a title", () => {
    const youtube = { provider: "youtube" as const, id: "dQw4w9WgXcQ", url: null, start: 0 };
    const html = renderToStaticMarkup(<VideoEmbed video={youtube} title="Team video" />);
    expect(html).toContain('title="Team video"');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');
    expect(html).toContain("sandbox=");

    const bad = { ...youtube, id: '"><script>' };
    expect(canEmbed(bad)).toBe(false);
    expect(renderToStaticMarkup(<VideoEmbed video={bad} title="x" />)).toBe("");

    const file = { provider: "file" as const, id: null, url: "https://cdn.example/v.mp4", start: 5 };
    expect(renderToStaticMarkup(<VideoEmbed video={file} title="Upload" />)).toContain(
      '<video src="https://cdn.example/v.mp4#t=5" title="Upload"'
    );
    expect(canEmbed({ ...file, url: null })).toBe(false);
  });
});

describe("uploads and image links", () => {
  test("checks type and size before presigning", () => {
    expect(checkUploadFile("slide_image", { type: "image/png", size: 1000 })).toBeNull();
    expect(checkUploadFile("slide_image", { type: "image/svg+xml", size: 1000 })).toBe(
      "This file type is not supported. Use PNG, JPEG, GIF, WEBP, AVIF."
    );
    expect(checkUploadFile("slide_image", { type: "image/png", size: 11 * 1024 * 1024 })).toBe(
      "This file is too large (max 10 MB)."
    );
    expect(checkUploadFile("slide_video", { type: "video/mp4", size: 0 })).toBe("This file is empty.");
    expect(checkUploadFile("slide_video", { type: "video/quicktime", size: 10 })).toContain("MP4, WEBM");
  });

  test("pasted image links must be https", () => {
    expect(isHttpsUrl("https://images.example.com/a.png")).toBe(true);
    for (const url of ["http://a.example/a.png", "javascript:alert(1)", "data:image/png;base64,AAA", "https://u:p@a.example/x", "nope"]) {
      expect(isHttpsUrl(url)).toBe(false);
    }
  });
});

describe("content security policy", () => {
  test("frames only the video players and loads images from https and storage", () => {
    const csp = buildCsp();
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com");
    expect(CSP_DIRECTIVES["img-src"]).toEqual(expect.arrayContaining(["'self'", "data:", "blob:", "https:"]));
    expect(csp).not.toContain("http: ");
  });

  test("adds the storage origin from its public URL", () => {
    expect(storageOrigins("http://localhost:9000/media/")).toEqual(["http://localhost:9000"]);
    expect(storageOrigins("https://cdn.example.com/bucket")).toEqual(["https://cdn.example.com"]);
    expect(storageOrigins(undefined)).toEqual([]);
    expect(storageOrigins("not a url")).toEqual([]);
    expect(storageOrigins("ftp://files.example.com")).toEqual([]);
  });
});
