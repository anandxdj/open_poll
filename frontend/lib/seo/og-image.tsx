import { ImageResponse } from "next/og";

import { SITE_NAME } from "./site";

// The social card for links to Open Poll (Open Graph and X): the hero's
// headline on graph paper beside a sample result, in the brand's type.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = `${SITE_NAME}: slides your audience can answer. Live polls, quizzes, word clouds and Q&A.`;

const PAPER = "#f6f6f3";
const SHEET = "#ffffff";
const INK = "#171717";
const GRAPHITE = "#5c5a55";
const RULE = "#e2e0d9";
const BRAND = "#ea580c";
const EMBER_INK = "#b93d0b";

const ROWS = [
  { label: "Jupiter", pct: 58, lead: true },
  { label: "Saturn", pct: 24 },
  { label: "Neptune", pct: 12 },
  { label: "Earth", pct: 6 },
];

/**
 * A Google Font as TrueType (the CSS API serves TrueType to clients that do
 * not ask for WOFF2). Null when offline: the card then uses the default font.
 */
async function googleFont(family: string, axes: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${axes}`).then((r) =>
      r.text(),
    );
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    return url ? await fetch(url).then((r) => r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function loadFonts() {
  const [sans, serif, mono] = await Promise.all([
    googleFont("Inter Tight", "wght@600"),
    googleFont("Instrument Serif", "ital@1"),
    googleFont("JetBrains Mono", "wght@500"),
  ]);
  return [
    sans && { name: "Inter Tight", data: sans, weight: 600 as const, style: "normal" as const },
    serif && { name: "Instrument Serif", data: serif, weight: 400 as const, style: "italic" as const },
    mono && { name: "JetBrains Mono", data: mono, weight: 500 as const, style: "normal" as const },
  ].filter((font) => font !== null);
}

function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="87 105 280 280" fill="none">
      <circle cx="292" cy="145" r="21" fill={BRAND} />
      <rect x="178" y="254" width="34" height="74" rx="14" fill={BRAND} />
      <rect x="227" y="215" width="34" height="113" rx="14" fill={BRAND} />
      <rect x="274.5" y="180" width="35" height="80" rx="13" fill={BRAND} />
      <path
        d="M292 240V294C292 324 268 347 232 347C197 347 170 333 156 314"
        stroke={BRAND}
        strokeWidth="35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export async function renderOgImage() {
  const step = 48;
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: PAPER,
          fontFamily: "Inter Tight",
          color: INK,
          position: "relative",
        }}
      >
        {/* Graph paper */}
        {Array.from({ length: Math.ceil(OG_SIZE.width / step) }, (_, i) => (
          <div
            key={`v${i}`}
            style={{ position: "absolute", left: i * step, top: 0, width: 1, height: "100%", background: RULE }}
          />
        ))}
        {Array.from({ length: Math.ceil(OG_SIZE.height / step) }, (_, i) => (
          <div
            key={`h${i}`}
            style={{ position: "absolute", top: i * step, left: 0, height: 1, width: "100%", background: RULE }}
          />
        ))}

        <div style={{ display: "flex", width: "100%", padding: "64px 72px", alignItems: "center", gap: 56 }}>
          {/* Brand, headline, line */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 32, letterSpacing: "-0.02em" }}>
              <Logo size={46} />
              {SITE_NAME}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                marginTop: "auto",
                fontSize: 88,
                lineHeight: 0.98,
                letterSpacing: "-0.05em",
              }}
            >
              <span>Slides your audience can&nbsp;</span>
              <span
                style={{
                  fontFamily: "Instrument Serif",
                  fontStyle: "italic",
                  fontSize: 96,
                  letterSpacing: "-0.02em",
                  color: BRAND,
                }}
              >
                answer
              </span>
              <span>.</span>
            </div>
            <div style={{ display: "flex", marginTop: 28, fontSize: 28, lineHeight: 1.35, color: GRAPHITE, maxWidth: 600 }}>
              Live polls, quizzes, word clouds and Q&amp;A. Your audience joins with a code.
            </div>
          </div>

          {/* A sample result */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 400,
              padding: 28,
              background: SHEET,
              border: `1px solid ${RULE}`,
              borderRadius: 24,
              boxShadow: "0 30px 60px -30px rgba(23,23,23,0.35)",
            }}
          >
            <div style={{ display: "flex", fontSize: 26, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              Which planet is the largest?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
              {ROWS.map((row, i) => (
                <div
                  key={row.label}
                  style={{
                    display: "flex",
                    position: "relative",
                    alignItems: "center",
                    height: 50,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: `1px solid ${row.lead ? "rgba(207,70,12,0.45)" : RULE}`,
                    overflow: "hidden",
                    fontSize: 20,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${row.pct}%`,
                      background: row.lead ? "rgba(207,70,12,0.15)" : "#efeee9",
                    }}
                  />
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      marginRight: 12,
                      fontFamily: "JetBrains Mono",
                      fontSize: 15,
                      color: row.lead ? "#ffffff" : GRAPHITE,
                      background: row.lead ? "#cf460c" : PAPER,
                      border: row.lead ? "none" : `1px solid ${RULE}`,
                    }}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span style={{ color: row.lead ? INK : GRAPHITE }}>{row.label}</span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontFamily: "JetBrains Mono",
                      fontSize: 18,
                      color: row.lead ? EMBER_INK : GRAPHITE,
                    }}
                  >
                    {row.pct}%
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 22,
                paddingTop: 18,
                borderTop: `1px solid ${RULE}`,
                fontSize: 18,
                color: GRAPHITE,
              }}
            >
              <span>Join code</span>
              <span style={{ fontFamily: "JetBrains Mono", fontSize: 24, letterSpacing: "0.08em", color: INK }}>
                482 913
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await loadFonts() },
  );
}
