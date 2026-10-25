import { Settings2, Timer, Trophy } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { isContentSlide, slideTypeMeta } from "../../../slides/meta";
import type { InspectorTabDef, InspectorTabProps } from "../inspectorTabs";

const labelClass = "text-sm font-medium text-foreground";
const numberInputClass = "h-10 bg-card tabular-nums";

/** Timing and scoring for the selected slide. */
function SettingsPanel({ slide, index, onChange }: InspectorTabProps) {
  const scored = slideTypeMeta(slide.type).scored;
  const timeId = `slide-${index}-time-limit`;
  const pointsId = `slide-${index}-points`;
  const speedId = `slide-${index}-speed-bonus`;

  return (
    <div className={`grid grid-cols-1 gap-4 ${scored ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
      <div className="space-y-2">
        <Label htmlFor={timeId} className={`${labelClass} flex items-center gap-1.5`}>
          <Timer className="size-3.5 text-accent-ink" /> Time limit (s)
        </Label>
        <Input
          id={timeId}
          type="number"
          min={5}
          max={300}
          value={slide.timeLimit}
          onChange={(e) => onChange({ timeLimit: Math.min(300, Math.max(5, Number(e.target.value) || 5)) })}
          className={numberInputClass}
        />
      </div>
      {scored ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={pointsId} className={`${labelClass} flex items-center gap-1.5`}>
              <Trophy className="size-3.5 text-accent-ink" /> Max points
            </Label>
            <Input
              id={pointsId}
              type="number"
              min={0}
              max={10000}
              step={100}
              value={slide.points}
              onChange={(e) => onChange({ points: Math.min(10000, Math.max(0, Number(e.target.value) || 0)) })}
              className={numberInputClass}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={speedId} className={labelClass}>
              Faster = more points
            </Label>
            <div className="flex items-center gap-3 h-10">
              <Switch
                id={speedId}
                checked={slide.scoreDependsOnTime}
                onCheckedChange={(checked) => onChange({ scoreDependsOnTime: checked })}
              />
              <span className="text-xs text-muted-foreground">
                {slide.scoreDependsOnTime ? "Speed bonus on (down to 50%)" : "Flat points for correct"}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className={labelClass}>Scoring</p>
          <p className="text-xs text-muted-foreground h-10 flex items-center">
            Interactive slide — no points, leaderboard unaffected.
          </p>
        </div>
      )}
    </div>
  );
}

export const settingsTab: InspectorTabDef = {
  id: "settings",
  label: "Settings",
  Icon: Settings2,
  order: 20,
  // Content slides and the Q&A board have no timer and no scoring.
  appliesTo: (slide) => !isContentSlide(slide.type) && slide.type !== "qna",
  Panel: SettingsPanel,
};
