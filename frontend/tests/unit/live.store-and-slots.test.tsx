import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { apiClient } from "@/lib/api-client";
import { createLiveStore } from "@/features/presentations/live/store";
import { getSlotEntries, registerSlot, SLOT_NAMES, SlotOutlet } from "@/features/presentations/live/slots";

describe("createLiveStore", () => {
  test("each store is independent and changes only through dispatch", () => {
    const a = createLiveStore("host");
    const b = createLiveStore("participant", { presentationId: "p" });
    a.getState().dispatch({ type: "live/connection", connected: true });
    expect(a.getState().connected).toBe(true);
    expect(b.getState().connected).toBe(false);
    expect(b.getState().role).toBe("participant");
    expect(b.getState().presentationId).toBe("p");
  });

  test("dispatch keeps the actions on the store", () => {
    const store = createLiveStore("participant");
    store.getState().dispatch({ type: "live/reset", role: "participant" });
    expect(typeof store.getState().dispatch).toBe("function");
    expect(typeof store.getState().submitAnswer).toBe("function");
  });

  test("submitAnswer without a joined participant on a slide is skipped (no request)", async () => {
    const store = createLiveStore("participant", { presentationId: "p" });
    expect(await store.getState().submitAnswer({ optionIndex: 0 })).toEqual({ status: "skipped" });
  });

  test("submitAnswer posts a multi-select answer as the generic payload", async () => {
    const post = spyOn(apiClient, "post").mockResolvedValue({ data: { data: { accepted: true } } });
    const get = spyOn(apiClient, "get").mockRejectedValue(new Error("offline"));
    try {
      const store = createLiveStore("participant", {
        presentationId: "p",
        self: { participantId: "u1", name: "Ada", token: "t".repeat(16) },
        slide: {
          slideIndex: 2,
          totalSlides: 3,
          type: "select_answer",
          scored: true,
          question: "Which are planets?",
          options: [{ text: "Mars" }, { text: "Moon" }, { text: "Earth" }],
          allowMultiple: true,
          statements: [],
          minLabel: "",
          maxLabel: "",
          scaleMax: 5,
          items: [],
          maxEntries: 3,
          timeLimit: 30,
          points: 1000,
          scoreDependsOnTime: true,
        },
      });
      expect(await store.getState().submitAnswer({ payload: { optionIndices: [0, 2] } })).toEqual({
        status: "accepted",
      });
      expect(post).toHaveBeenCalledWith("/presentations/p/answer", {
        participantId: "u1",
        participantToken: "t".repeat(16),
        slideIndex: 2,
        payload: { optionIndices: [0, 2] },
      });
      expect(store.getState().submittedSlideIndex).toBe(2);
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });
});

describe("live slots", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
  const props = { presentationId: "p", participantId: "x" };

  test("the slot list is the documented one", () => {
    expect([...SLOT_NAMES]).toEqual([
      "participantTabs",
      "participantFooter",
      "participantBanner",
      "participantBody",
      "endScreen",
      "stageOverlays",
      "presenterPanels",
      "hostToolbar",
    ]);
  });

  test("an empty slot renders nothing at all", () => {
    expect(renderToStaticMarkup(<SlotOutlet name="participantFooter" props={props} />)).toBe("");
  });

  test("entries render in order, without wrapper markup, with the slot props", () => {
    cleanups.push(
      registerSlot("participantFooter", { id: "b", order: 20, Component: ({ participantId }) => <i>b:{participantId}</i> }),
      registerSlot("participantFooter", { id: "a", order: 10, Component: () => <i>a</i> }),
      registerSlot("participantFooter", { id: "c", Component: () => <i>c</i> })
    );
    expect(renderToStaticMarkup(<SlotOutlet name="participantFooter" props={props} />)).toBe("<i>a</i><i>b:x</i><i>c</i>");
  });

  test("`when` filters entries per render", () => {
    cleanups.push(
      registerSlot("participantBanner", { id: "only-x", when: (p) => p.participantId === "x", Component: () => <b>x</b> })
    );
    expect(getSlotEntries("participantBanner", props).map((e) => e.id)).toEqual(["only-x"]);
    expect(getSlotEntries("participantBanner", { ...props, participantId: "y" })).toEqual([]);
    expect(getSlotEntries("participantBanner").map((e) => e.id)).toEqual(["only-x"]);
  });

  test("registering an id again replaces the entry; unregister removes it", () => {
    const first = registerSlot("hostToolbar", { id: "remote", label: "v1", Component: () => null });
    const second = registerSlot("hostToolbar", { id: "remote", label: "v2", Component: () => null });
    expect(getSlotEntries("hostToolbar").map((e) => e.label)).toEqual(["v2"]);
    first(); // stale unregister: no-op
    expect(getSlotEntries("hostToolbar")).toHaveLength(1);
    second();
    expect(getSlotEntries("hostToolbar")).toHaveLength(0);
  });
});
