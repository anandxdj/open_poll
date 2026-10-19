import { useId } from "react";

import { Input } from "@/components/ui/input";
import { ItemsField, NumberField } from "../../advanced/editorFields";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { blankBase, cleanBase, entryInputClass, EditorNote, FieldLabel, padTo, requireQuestion } from "../../editorKit";
import {
  axisIssue,
  DEFAULT_AXIS_RANGE,
  GRID_AXIS_LIMIT,
  MAX_AXIS_LABEL,
  MAX_GRID_ITEMS,
  MIN_GRID_ITEMS,
  rawGridConfig,
  type Grid2x2Config,
  type GridAxis,
} from "./config";
import { meta } from "./meta";

function AxisFields({
  title,
  placeholder,
  axis,
  onChange,
}: {
  title: string;
  placeholder: string;
  axis: GridAxis;
  onChange: (axis: GridAxis) => void;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-3 rounded-2xl border border-border/40 bg-secondary/10 p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">{title}</legend>
      <div className="space-y-2">
        <FieldLabel htmlFor={`${id}-label`}>Name</FieldLabel>
        <Input
          id={`${id}-label`}
          value={axis.label}
          maxLength={MAX_AXIS_LABEL}
          placeholder={placeholder}
          onChange={(event) => onChange({ ...axis, label: event.target.value })}
          className={entryInputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Lowest" value={axis.min} step={1} onChange={(min) => onChange({ ...axis, min })} />
        <NumberField label="Highest" value={axis.max} step={1} onChange={(max) => onChange({ ...axis, max })} />
      </div>
    </fieldset>
  );
}

function Grid2x2Editor({ slide, onChange }: SlideEditorProps) {
  const config = rawGridConfig(slide);
  const setConfig = (patch: Partial<Grid2x2Config>) => onChange({ config: { ...config, ...patch } });

  return (
    <div className="space-y-6">
      <ItemsField
        label="Items to place on the grid"
        items={config.items}
        onChange={(items) => setConfig({ items })}
        min={MIN_GRID_ITEMS}
        max={MAX_GRID_ITEMS}
        placeholder={(i) => `Item ${i + 1}`}
        addLabel="Add item"
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AxisFields
          title="Horizontal axis"
          placeholder="e.g. Effort"
          axis={config.x}
          onChange={(x) => setConfig({ x })}
        />
        <AxisFields
          title="Vertical axis"
          placeholder="e.g. Impact"
          axis={config.y}
          onChange={(y) => setConfig({ y })}
        />
      </div>
      <EditorNote>
        Each participant places every item on the grid by tapping it. The stage shows each item at the average position
        the audience gave it. This slide is never scored.
      </EditorNote>
    </div>
  );
}

const cleanItems = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);

const cleanAxis = (axis: GridAxis): GridAxis => ({
  label: axis.label.trim(),
  min: Math.round(axis.min),
  max: Math.round(axis.max),
});

export const editor: SlideEditorDef = {
  meta,
  blank: () => ({
    ...blankBase(meta),
    timeLimit: 60,
    config: {
      items: ["", ""],
      x: { label: "", ...DEFAULT_AXIS_RANGE },
      y: { label: "", ...DEFAULT_AXIS_RANGE },
    },
  }),
  Editor: Grid2x2Editor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    const { items, x, y } = rawGridConfig(slide);
    if (items.length < MIN_GRID_ITEMS) return "add at least one item.";
    if (items.length > MAX_GRID_ITEMS) return `use at most ${MAX_GRID_ITEMS} items.`;
    return axisIssue(x, "horizontal") ?? axisIssue(y, "vertical");
  },
  clean: (slide) => {
    const { items, x, y } = rawGridConfig(slide);
    return { ...cleanBase(slide, meta), config: { items: cleanItems(items), x: cleanAxis(x), y: cleanAxis(y) } };
  },
  fillDraft: (slide) => {
    const { items, x, y } = rawGridConfig(slide);
    const fill = (axis: GridAxis, fallback: string): GridAxis => {
      const min = Math.round(axis.min);
      const max = Math.round(axis.max);
      const usable = max > min && Math.abs(min) <= GRID_AXIS_LIMIT && Math.abs(max) <= GRID_AXIS_LIMIT;
      return {
        label: axis.label.trim().slice(0, MAX_AXIS_LABEL) || fallback,
        ...(usable ? { min, max } : DEFAULT_AXIS_RANGE),
      };
    };
    return {
      ...slide,
      config: {
        items: padTo(cleanItems(items), MIN_GRID_ITEMS, (i) => `Item ${i + 1}`).slice(0, MAX_GRID_ITEMS),
        x: fill(x, "Horizontal"),
        y: fill(y, "Vertical"),
      },
    };
  },
};
