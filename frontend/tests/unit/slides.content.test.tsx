import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { isSlideDirty } from "@/features/presentations/components/builder/deckDraft";
import { StageView } from "@/features/presentations/components/stage/StageView";
import { createLiveStore, LiveStoreProvider } from "@/features/presentations/live/store";
import { MarkdownLite, parseMarkdownLite, safeHref } from "@/features/presentations/slides/content/markdown";
import {
  readBigNumber,
  readBullets,
  readHeading,
  readImage,
  readInstructions,
  readParagraph,
  readQuote,
  readVideo,
} from "@/features/presentations/slides/content/payloads";
import {
  blankSlide,
  cleanSlide,
  normalizeSlideForDraft,
  SLIDE_EDITORS,
  validateSlide,
} from "@/features/presentations/slides/editor";
import { slideLabel } from "@/features/presentations/slides/meta";
import { getSlideRuntime, type ParticipantMode } from "@/features/presentations/slides/runtime";
import type { LiveSlide, PresentationSlide } from "@/features/presentations/types";
import {
  CONTENT_SLIDE_TYPES,
  type ContentSlideType,
  type SlideContent,
} from "@/features/presentations/types/content";

// The eight content slide types: editor contract (blank → validate → clean →
// draft), the markdown-lite renderer, and the runtime views (participant
// modes, stage layouts).

/** Content that makes a blank slide of each type saveable. */
const FILLED: Record<ContentSlideType, SlideContent> = {
  heading: { title: "  Welcome  ", subtitle: " Kick-off " },
  paragraph: { title: "", body: " We **ship** weekly. " },
  bullets: { title: "Agenda", items: [" Intro ", "", "Demo"] },
  image: { key: null, url: " https://images.example.com/team.jpg ", alt: " The team ", fit: "cover", caption: "" },
  big_number: { value: 87.5, label: " of teams ", prefix: "", suffix: "%" },
  quote: { text: " Less is more. ", attribution: " Mies " },
  video: { provider: "youtube", id: "dQw4w9WgXcQ", key: "stray", url: "stray", start: 42 },
  instructions: { showQr: true, showCode: false, text: " Grab your phone " },
};

/** What a cleaned FILLED slide stores. */
const CLEANED: Record<ContentSlideType, SlideContent> = {
  heading: { title: "Welcome", subtitle: "Kick-off" },
  paragraph: { title: "", body: "We **ship** weekly." },
  bullets: { title: "Agenda", items: ["Intro", "Demo"] },
  image: { key: null, url: "https://images.example.com/team.jpg", alt: "The team", fit: "cover", caption: "" },
  big_number: { value: 87.5, label: "of teams", prefix: "", suffix: "%" },
  quote: { text: "Less is more.", attribution: "Mies" },
  video: { provider: "youtube", id: "dQw4w9WgXcQ", key: null, url: null, start: 42 },
  instructions: { showQr: true, showCode: false, text: "Grab your phone" },
};

/** What a blank slide's validation says (instructions are valid as they come). */
const BLANK_ERRORS: Record<ContentSlideType, string | null> = {
  heading: "add a title.",
  paragraph: "add some text.",
  bullets: "add at least one bullet.",
  image: "choose an image or paste an https link.",
  big_number: "enter the number to show.",
  quote: "add the quote text.",
  video: "paste a YouTube or Vimeo link.",
  instructions: null,
};

/** Mirrors the backend content schemas (backend/src/modules/presentations/slides/types/content). */
function passesApiRules(slide: PresentationSlide): boolean {
  if (slide.timeLimit !== 0 || slide.question !== "") return false;
  const c = slide.content;
  switch (slide.type) {
    case "heading":
      return readHeading(c).title.length > 0;
    case "paragraph": {
      const { body } = readParagraph(c);
      return body.length > 0 && body.length <= 2000;
    }
    case "bullets": {
      const { items } = readBullets(c);
      return items.length >= 1 && items.length <= 10 && items.every((item) => item.length > 0);
    }
    case "image": {
      const { key, url, alt } = readImage(c);
      return alt.length > 0 && (key !== null || url === null || url.startsWith("https://"));
    }
    case "big_number":
      return readBigNumber(c).value !== null;
    case "quote":
      return readQuote(c).text.length > 0;
    case "video": {
      const { provider, id } = readVideo(c);
      return provider === "file" || id === null || /^[A-Za-z0-9_-]{11}$|^[1-9]\d{5,11}$/.test(id);
    }
    case "instructions":
      return readInstructions(c).text.length <= 300;
    default:
      return false;
  }
}

const liveSlide = (slide: PresentationSlide, slideIndex = 2, totalSlides = 5): LiveSlide =>
  Object.assign(
    {
      slideIndex,
      totalSlides,
      type: slide.type,
      scored: false,
      question: "",
      options: [],
      statements: [],
      minLabel: "",
      maxLabel: "",
      scaleMax: 5,
      items: [],
      maxEntries: 3,
      timeLimit: 0,
      points: 0,
      scoreDependsOnTime: false,
    },
    { content: slide.content }
  );

const filled = (type: ContentSlideType): PresentationSlide => cleanSlide({ ...blankSlide(type), content: FILLED[type] });

const render = (node: React.ReactNode) => renderToStaticMarkup(<LiveIntlProvider>{node}</LiveIntlProvider>);

const participantHtml = (type: ContentSlideType, mode: ParticipantMode) => {
  const runtime = getSlideRuntime(type)!;
  return render(
    <runtime.ParticipantView slide={liveSlide(filled(type))} mode={mode} onSubmit={() => {}} submitting={false} />
  );
};

describe("content slide editors", () => {
  for (const type of CONTENT_SLIDE_TYPES) {
    test(`${type}: blank → validate → clean → draft`, () => {
      const def = SLIDE_EDITORS[type];
      const blank = def.blank();
      expect(blank).toMatchObject({ type, question: "", timeLimit: 0, points: 0, scoreDependsOnTime: false });
      expect(blank.content).toBeDefined();
      expect(def.blank()).not.toBe(blank);

      expect(def.validate(def.clean(blank))).toBe(BLANK_ERRORS[type]);

      const cleaned = def.clean({ ...blank, question: "stray question", timeLimit: 30, content: FILLED[type] });
      expect(cleaned.content).toEqual(CLEANED[type]);
      expect(cleaned).toMatchObject({ question: "", timeLimit: 0 });
      expect(def.validate(cleaned)).toBeNull();
      expect(def.clean(cleaned)).toEqual(cleaned);
      expect(passesApiRules(cleaned)).toBe(true);
      expect(validateSlide(cleaned)).toBeNull();

      // Silent drafts of an unfinished slide still pass the API rules.
      const draft = normalizeSlideForDraft(blank);
      expect(draft.question).toBe("");
      expect(passesApiRules(draft)).toBe(true);
    });
  }

  test("type-specific validation", () => {
    const withContent = (type: ContentSlideType, content: SlideContent) =>
      validateSlide(cleanSlide({ ...blankSlide(type), content }));
    expect(withContent("paragraph", { title: "", body: "Click [here](javascript:alert(1))" })).toBe(
      "links must start with https://, http:// or mailto:."
    );
    expect(withContent("image", { key: null, url: "https://x.example/a.png", alt: "  ", fit: "contain", caption: "" })).toBe(
      "add alt text describing the image."
    );
    expect(withContent("image", { key: null, url: "http://x.example/a.png", alt: "A", fit: "contain", caption: "" })).toBe(
      "image links must start with https://."
    );
    expect(withContent("image", { key: "uploads/ws/a.png", url: null, alt: "A", fit: "contain", caption: "" })).toBeNull();
    expect(withContent("big_number", { value: 1e16, label: "", prefix: "", suffix: "" })).toBe("the number is too large.");
    expect(withContent("video", { provider: "file", id: null, key: null, url: null, start: 0 })).toBe(
      "upload a video file."
    );
    expect(withContent("video", { provider: "youtube", id: "not-an-id", key: null, url: null, start: 0 })).toBe(
      "paste a YouTube or Vimeo link."
    );
    expect(withContent("instructions", { showQr: false, showCode: false, text: " " })).toBe(
      "show the QR code, the join code or some text."
    );
  });

  test("drafts fill what the API requires", () => {
    const draftOf = (type: ContentSlideType, content: SlideContent) =>
      normalizeSlideForDraft({ ...blankSlide(type), content }).content;
    expect(draftOf("heading", { title: "", subtitle: "" })).toEqual({ title: "Untitled heading", subtitle: "" });
    expect(draftOf("bullets", { title: "", items: ["", " "] })).toEqual({ title: "", items: ["Untitled bullet"] });
    expect(draftOf("big_number", { value: null, label: "", prefix: "", suffix: "" })).toMatchObject({ value: 0 });
    expect(draftOf("image", { key: null, url: "http://x.example/a.png", alt: "", fit: "contain", caption: "" })).toEqual({
      key: null,
      url: null,
      alt: "Image",
      fit: "contain",
      caption: "",
    });
  });

  test("content slides are named by their own text, and count as edited once they have some", () => {
    expect(slideLabel(filled("heading"))).toBe("Welcome");
    expect(slideLabel(filled("paragraph"))).toBe("We **ship** weekly.");
    expect(slideLabel(filled("bullets"))).toBe("Agenda");
    expect(slideLabel(filled("image"))).toBe("The team");
    expect(slideLabel(filled("big_number"))).toBe("87.5% of teams");
    expect(slideLabel(filled("video"))).toBe("YouTube video");
    expect(slideLabel(blankSlide("heading"))).toBe("Heading");
    expect(slideLabel(blankSlide("instructions"))).toBe("How to join");

    expect(isSlideDirty(blankSlide("quote"))).toBe(false);
    expect(isSlideDirty(filled("quote"))).toBe(true);
  });
});

describe("markdown-lite", () => {
  const html = (text: string, linkable = true) => renderToStaticMarkup(<MarkdownLite text={text} linkable={linkable} />);

  test("renders bold, italic, links, paragraphs and line breaks", () => {
    expect(html("We **ship** *weekly* and _daily_.\nSee [the plan](https://example.com/plan).\n\nNext")).toBe(
      '<div><p>We <strong>ship</strong> <em>weekly</em> and <em>daily</em>.<br/>See <a href="https://example.com/plan" target="_blank" rel="noopener noreferrer nofollow">the plan</a>.</p><p>Next</p></div>'
    );
    expect(html("*a **b** c*")).toBe("<div><p><em>a <strong>b</strong> c</em></p></div>");
    expect(html("**[docs](mailto:hi@example.com)**")).toBe(
      '<div><p><strong><a href="mailto:hi@example.com" target="_blank" rel="noopener noreferrer nofollow">docs</a></strong></p></div>'
    );
  });

  test("escapes HTML instead of rendering it", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror="alert(1)"> **<b>x</b>**');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("<strong>&lt;b&gt;x&lt;/b&gt;</strong>");
  });

  test("never links unsafe targets; keeps only their label", () => {
    for (const target of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "vbscript:x", "/relative", "//evil.example"]) {
      const out = html(`[click](${target})`);
      expect(out).toBe("<div><p>click</p></div>");
    }
    expect(safeHref("https://example.com")).toBe("https://example.com/");
    expect(safeHref("java\nscript:alert(1)")).toBeNull();
    // Balanced parentheses stay part of the target.
    expect(html("[Foo](https://en.wikipedia.org/wiki/Foo_(bar))")).toContain(
      'href="https://en.wikipedia.org/wiki/Foo_(bar)"'
    );
  });

  test("leaves stray markers, snake_case, math and escapes as text", () => {
    expect(parseMarkdownLite("snake_case_name and 2 * 3 * 4")).toEqual([
      [[{ type: "text", text: "snake_case_name and 2 * 3 * 4" }]],
    ]);
    expect(html("**unclosed and *open")).toBe("<div><p>**unclosed and *open</p></div>");
    expect(html("\\*not italic\\* and \\[not](a link)")).toBe("<div><p>*not italic* and [not](a link)</p></div>");
  });

  test("inert previews draw links as text", () => {
    expect(html("[site](https://example.com)", false)).toBe("<div><p><span>site</span></p></div>");
  });
});

describe("content slide runtime views", () => {
  for (const type of CONTENT_SLIDE_TYPES) {
    test(`${type}: presenter pace points at the screen; audience pace shows the slide`, () => {
      const live = participantHtml(type, "live");
      expect(live).toContain("Look at the screen");
      expect(live).toContain("Slide 3 of 5");

      const audience = participantHtml(type, "audience");
      expect(audience).not.toContain("Look at the screen");
      expect(participantHtml(type, "preview")).not.toContain("Look at the screen");
    });
  }

  test("audience views draw the content", () => {
    expect(participantHtml("heading", "audience")).toContain("Welcome");
    expect(participantHtml("paragraph", "audience")).toContain("<strong");
    expect(participantHtml("bullets", "audience")).toContain("Demo");
    expect(participantHtml("image", "audience")).toContain('alt="The team"');
    expect(participantHtml("big_number", "audience")).toContain("87.5");
    expect(participantHtml("quote", "audience")).toContain("Less is more.");
    expect(participantHtml("video", "audience")).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&amp;start=42");
    expect(participantHtml("video", "preview")).not.toContain("<iframe");
    expect(participantHtml("instructions", "audience")).toContain("Grab your phone");
  });

  const stageHtml = (slide: PresentationSlide, mode: "live" | "thumbnail" | "report" = "live") =>
    render(<StageView slide={slide} mode={mode} />);

  test("stage views draw the slide with deck tokens", () => {
    const heading = stageHtml(filled("heading"));
    expect(heading).toContain("<h2");
    expect(heading).toContain("Welcome");
    expect(heading).toContain("Kick-off");
    expect(stageHtml(filled("paragraph"))).toContain('<strong class="font-bold text-deck-stage-fg">ship</strong>');
    expect(stageHtml(filled("bullets"))).toContain("Intro");
    expect(stageHtml(filled("quote"))).toContain("<blockquote");
    expect(stageHtml(filled("big_number"), "report")).toContain("87.5");

    const image = stageHtml(filled("image"));
    expect(image).toContain('src="https://images.example.com/team.jpg"');
    expect(image).toContain('alt="The team"');
    expect(image).toContain("object-cover");
    expect(image).toContain('referrerPolicy="no-referrer"');

    const video = stageHtml(filled("video"));
    expect(video).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&amp;start=42"');
    expect(video).toContain('title="YouTube video"');
    expect(stageHtml(filled("video"), "thumbnail")).not.toContain("<iframe");

    const vimeo = stageHtml({ ...filled("video"), content: { ...CLEANED.video, provider: "vimeo", id: "76979871" } });
    expect(vimeo).toContain('src="https://player.vimeo.com/video/76979871?dnt=1#t=42s"');
  });

  test("stage views of blank slides draw placeholders, never broken media", () => {
    for (const type of CONTENT_SLIDE_TYPES) {
      const out = stageHtml(blankSlide(type), "thumbnail");
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain("<iframe");
      expect(out).not.toContain("<img");
    }
    expect(stageHtml(blankSlide("image"), "thumbnail")).toContain("No image yet");
    expect(stageHtml(blankSlide("video"), "thumbnail")).toContain("No video yet");
  });

  test("the instructions slide shows the session's join code on the stage", () => {
    const store = createLiveStore("host", { joinCode: "424242" });
    const out = renderToStaticMarkup(
      <LiveIntlProvider>
        <LiveStoreProvider store={store}>
          <StageView slide={{ ...filled("instructions"), content: { ...CLEANED.instructions, showCode: true } }} mode="live" />
        </LiveStoreProvider>
      </LiveIntlProvider>
    );
    expect(out).toContain("424242");
    expect(out).toContain("Grab your phone");
    expect(stageHtml(blankSlide("instructions"), "thumbnail")).not.toContain("424242");
  });
});
