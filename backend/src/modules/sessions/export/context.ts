import type { IPresentation } from '../../presentations/models/presentation.model';
import type { IPresentationSession } from '../../presentations/models/session.model';
import { sessionResults, standingsOf, type SlideResults } from '../results';
import {
  exportSlidesOf,
  loadRankedParticipants,
  loadSlideAnswers,
  type ExportSlide,
  type RankedParticipant,
} from './rows';
import { summarizeDistribution, tallyAnswers, type DistributionSummary } from './summary';

/** Everything an export writer needs, loaded once per download. */
export interface ExportContext {
  session: IPresentationSession;
  sessionId: string;
  title: string;
  slides: ExportSlide[];
  participants: RankedParticipant[];
  results: Map<string, SlideResults>;
  generatedAt: Date;
}

export const buildExportContext = async (
  session: IPresentationSession,
  presentation: Pick<IPresentation, 'title'>
): Promise<ExportContext> => {
  const sessionId = String(session._id);
  const [standings, results] = await Promise.all([standingsOf(session), sessionResults(session)]);
  const participants = await loadRankedParticipants(sessionId, standings);
  return {
    session,
    sessionId,
    title: presentation.title,
    slides: exportSlidesOf(session),
    participants,
    results,
    generatedAt: new Date(),
  };
};

/** Answer count of a slide: the stored/live results, else 0. */
export const answeredCountOf = (ctx: ExportContext, slide: ExportSlide) =>
  ctx.results.get(slide.slideId)?.answeredCount ?? 0;

/** The slide's results as label → value rows (a tally of answers for unknown result shapes). */
export const summaryOf = async (ctx: ExportContext, slide: ExportSlide): Promise<DistributionSummary> =>
  summarizeDistribution(ctx.results.get(slide.slideId)?.distribution) ??
  tallyAnswers(slide, await loadSlideAnswers(ctx.sessionId, slide.slideId));
