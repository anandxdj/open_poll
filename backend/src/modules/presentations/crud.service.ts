import crypto from 'crypto';
import { ApiError } from '../../common/utils/ApiError';
import { redisClient } from '../../common/config/redis';
import { PresentationModel, type IPresentation, type IPresentationSlide } from './models/presentation.model';
import { PresentationParticipantModel } from './models/participant.model';
import { PresentationAnswerModel } from './models/answer.model';
import { allPresentationKeys } from './live/keys';
import type { CreatePresentationInput, UpdatePresentationInput } from './presentations.schema';

const generateJoinCode = () => crypto.randomInt(100000, 1000000).toString();

export const createPresentation = async (data: CreatePresentationInput, creatorId: string) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await PresentationModel.create({
        ...data,
        creatorId,
        joinCode: generateJoinCode(),
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }
  throw ApiError.internal('Could not allocate a unique join code, please retry');
};

export const getPresentationById = async (presentationId: string) => {
  const presentation = await PresentationModel.findById(presentationId);
  if (!presentation) throw ApiError.notFound('Presentation deck not found');
  return presentation;
};

export const assertOwnership = async (presentationId: string, userId: string): Promise<IPresentation> => {
  const presentation = await getPresentationById(presentationId);
  if (presentation.creatorId !== userId) {
    throw ApiError.forbidden('You do not have permission to manage this presentation');
  }
  return presentation;
};

/** Non-throwing ownership check for the socket layer, which just needs a yes/no. */
export const isOwner = async (presentationId: string, userId: string): Promise<boolean> => {
  try {
    await assertOwnership(presentationId, userId);
    return true;
  } catch {
    return false;
  }
};

export const listPresentationsByCreator = async (creatorId: string) =>
  PresentationModel.find({ creatorId }).sort({ createdAt: -1 });

export const updatePresentation = async (
  presentationId: string,
  userId: string,
  data: UpdatePresentationInput
) => {
  const presentation = await assertOwnership(presentationId, userId);
  if (presentation.status !== 'draft' && presentation.status !== 'ended') {
    throw ApiError.badRequest('Cannot edit a presentation deck while a live session is running');
  }
  if (data.title !== undefined) presentation.title = data.title;
  if (data.slides !== undefined) presentation.slides = data.slides as IPresentationSlide[];
  await presentation.save();
  return presentation;
};

export const deletePresentation = async (presentationId: string, userId: string) => {
  const presentation = await assertOwnership(presentationId, userId);
  await Promise.all([
    PresentationModel.findByIdAndDelete(presentationId),
    PresentationParticipantModel.deleteMany({ presentationId }),
    PresentationAnswerModel.deleteMany({ presentationId }),
    redisClient.del(allPresentationKeys(presentationId, presentation.slides.length)).catch(() => {}),
  ]);
};
