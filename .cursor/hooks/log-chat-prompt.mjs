#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const raw = await new Response(Bun.stdin.stream()).text();

let input = {};
try {
  input = raw ? JSON.parse(raw) : {};
} catch {
  input = {};
}

const findPromptText = (value) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const preferredKeys = ["prompt", "userPrompt", "message", "input", "query", "text"];
  for (const key of preferredKeys) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key];
    }
  }

  for (const child of Object.values(value)) {
    const found = findPromptText(child);
    if (found) return found;
  }
  return "";
};

const fullPrompt = findPromptText(input).replace(/\s+/g, " ").trim();
const preview = fullPrompt ? fullPrompt.slice(0, 180) : "no-prompt-found";

let taskHint = "general";
const lower = fullPrompt.toLowerCase();
if (lower.includes("poll")) taskHint = "polls";
if (lower.includes("response") || lower.includes("vote")) taskHint = "responses";
if (lower.includes("socket") || lower.includes("redis") || lower.includes("realtime")) taskHint = "realtime";
if (lower.includes("ai") || lower.includes("langchain") || lower.includes("langgraph") || lower.includes("gemini")) taskHint = "ai";
if (lower.includes("setup") || lower.includes("docker") || lower.includes("test")) taskHint = "setup";

const logPath = resolve(process.cwd(), "backend/docs/wiki/chat-log.md");
const logDir = dirname(logPath);
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

const entry = `- ${new Date().toISOString()} | ${preview} | ${taskHint}\n`;
appendFileSync(logPath, entry, "utf8");

const output = { permission: "allow" };
process.stdout.write(JSON.stringify(output));
