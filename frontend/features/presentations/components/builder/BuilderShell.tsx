import type { ReactNode } from "react";

/** Page frame of the deck builder: header on top, slide rail beside the inspector. */
export function BuilderShell({ header, rail, children }: { header: ReactNode; rail: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col h-full min-h-0 max-w-6xl mx-auto w-full p-4 sm:p-6 gap-4 sm:gap-6 overflow-hidden">
      {header}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 items-stretch flex-1 min-h-0 overflow-hidden">
        {rail}
        {children}
      </div>
    </div>
  );
}
