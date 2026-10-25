import { GRADED_POINTS, GradedSwitch, IssueNote, NumberField } from "../../advanced/editorFields";
import { formatNumber, roundTo } from "../../advanced/read";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { blankBase, cleanBase, EditorNote, requireQuestion } from "../../editorKit";
import {
  DEFAULT_GUESS_CONFIG,
  guessConfigIssue,
  isGradedGuess,
  rawGuessConfig,
  snapGuess,
  type GuessNumberConfig,
} from "./config";
import { meta } from "./meta";

/** Seconds a graded slide needs (speed scoring needs a deadline). */
const MIN_GRADED_TIMER = 5;

function GuessNumberEditor({ slide, onChange }: SlideEditorProps) {
  const config = rawGuessConfig(slide);
  const graded = isGradedGuess(slide);
  const setConfig = (patch: Partial<GuessNumberConfig>) => onChange({ config: { ...config, ...patch } });

  const setGraded = (next: boolean) => {
    if (!next) {
      // The correct number stays while editing (switching back restores it); `clean` drops it on save.
      onChange({ points: 0, scoreDependsOnTime: false });
      return;
    }
    const range = guessConfigIssue({ ...config, correct: null }, false) ? DEFAULT_GUESS_CONFIG : config;
    onChange({
      points: GRADED_POINTS,
      scoreDependsOnTime: true,
      timeLimit: slide.timeLimit >= MIN_GRADED_TIMER ? slide.timeLimit : 30,
      config: { ...config, correct: config.correct ?? snapGuess((range.min + range.max) / 2, range) },
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NumberField label="Min" value={config.min} onChange={(min) => setConfig({ min })} />
        <NumberField label="Max" value={config.max} onChange={(max) => setConfig({ max })} />
        <NumberField label="Step" value={config.step} min={0} onChange={(step) => setConfig({ step })} />
      </div>

      <GradedSwitch
        graded={graded}
        onChange={setGraded}
        hintOn="Guesses near the correct number score points"
        hintOff="Results only — no correct number, no points"
      />

      {graded && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            label="Correct number"
            value={config.correct}
            placeholder="e.g. 79"
            onChange={(correct) => setConfig({ correct })}
            hint="Hidden from participants until you reveal the results."
          />
          <NumberField
            label="Tolerance (±)"
            value={config.tolerance}
            min={0}
            onChange={(tolerance) => setConfig({ tolerance })}
            hint="A guess this close to the correct number counts as correct. 0 = exact."
          />
        </div>
      )}

      <IssueNote issue={guessConfigIssue(config, graded)} />
      <EditorNote>
        Participants choose a number from {formatNumber(config.min, 4)} to {formatNumber(config.max, 4)} with a slider
        or by typing it. The stage shows the guesses as a histogram with their mean and median.
      </EditorNote>
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  // Ungraded until the author turns grading on and sets a correct number.
  blank: () => ({
    ...blankBase(meta),
    points: 0,
    scoreDependsOnTime: false,
    config: { ...DEFAULT_GUESS_CONFIG },
  }),
  Editor: GuessNumberEditor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    const graded = isGradedGuess(slide);
    const issue = guessConfigIssue(rawGuessConfig(slide), graded);
    if (issue) return issue;
    if (graded && slide.timeLimit < MIN_GRADED_TIMER) {
      return `scored slides need a timer of at least ${MIN_GRADED_TIMER} seconds.`;
    }
    return null;
  },
  clean: (slide) => {
    const graded = isGradedGuess(slide);
    const { min, max, step, correct, tolerance } = rawGuessConfig(slide);
    return {
      ...cleanBase(slide, meta),
      points: graded ? slide.points : 0,
      scoreDependsOnTime: graded ? slide.scoreDependsOnTime : false,
      // An ungraded slide has no correct number: a 0-point slide shows results only.
      config: { min, max, step, correct: graded ? correct : null, tolerance: graded ? tolerance : 0 },
    };
  },
  fillDraft: (slide) => {
    const c = rawGuessConfig(slide);
    const range = guessConfigIssue({ ...c, correct: null, tolerance: 0 }, false) ? DEFAULT_GUESS_CONFIG : c;
    const config: GuessNumberConfig = {
      min: range.min,
      max: range.max,
      step: range.step,
      correct: c.correct === null ? null : snapGuess(c.correct, range),
      tolerance: roundTo(Math.min(c.tolerance, 2_000_000_000), 4),
    };
    // Graded slides with a correct number need a timer.
    const needsTimer = config.correct !== null && slide.points > 0 && slide.timeLimit < MIN_GRADED_TIMER;
    return { ...slide, config, ...(needsTimer ? { timeLimit: 30 } : {}) };
  },
};
