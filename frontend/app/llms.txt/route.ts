import { buildLlmsTxt } from "@/lib/seo/llms";

// Built once at build time; it only changes with the code.
export const dynamic = "force-static";

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
