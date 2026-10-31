import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';
import { FONT_CHOICES, type FontChoice } from './fonts';
import type { ThemeColors } from './resolve';

/** Most brand kits one workspace keeps. */
export const MAX_BRAND_KITS = 20;

/**
 * A workspace's brand (W3-A): a full palette, fonts, an optional logo and
 * background picture. Decks pick one in their theme; sessions snapshot the
 * resolved tokens when they open, so later edits never restyle past sessions.
 */
export interface IBrandKit extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  colors: ThemeColors;
  fonts: { heading: FontChoice; body: FontChoice };
  logo: { url: string; alt: string } | null;
  background: { imageUrl: string; overlayOpacity: number } | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const colorsSchema = new Schema<ThemeColors>(
  {
    background: { type: String, required: true },
    surface: { type: String, required: true },
    text: { type: String, required: true },
    mutedText: { type: String, required: true },
    accent: { type: String, required: true },
    accentText: { type: String, required: true },
    correct: { type: String, required: true },
    incorrect: { type: String, required: true },
    chart: { type: [String], default: [] },
  },
  { _id: false },
);

const brandKitSchema = new Schema<IBrandKit>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    colors: { type: colorsSchema, required: true },
    fonts: {
      heading: { type: String, enum: FONT_CHOICES, required: true },
      body: { type: String, enum: FONT_CHOICES, required: true },
    },
    logo: {
      type: new Schema({ url: { type: String, required: true }, alt: { type: String, default: '' } }, { _id: false }),
      default: null,
    },
    background: {
      type: new Schema(
        { imageUrl: { type: String, required: true }, overlayOpacity: { type: Number, default: 0.5, min: 0, max: 0.9 } },
        { _id: false },
      ),
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  // Production indexes come from migrations (bun run migrate), not boot.
  { timestamps: true, autoIndex: !env.isProduction },
);

brandKitSchema.index({ workspaceId: 1, createdAt: 1 });

export const BrandKitModel = mongoose.model<IBrandKit>('BrandKit', brandKitSchema);
