import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * External sign-in providers. `google` and `oidc` are the global providers;
 * `saml` and `oidc_ws` are per-workspace SSO connections (identified by
 * `connectionId`), so the same subject may exist under different connections.
 */
export const IDENTITY_PROVIDERS = ['google', 'oidc', 'saml', 'oidc_ws'] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

export interface IUserIdentity {
  provider: IdentityProvider;
  connectionId?: Types.ObjectId | null;
  subject: string;
}

export interface IUser extends Document {
  email: string;
  name: string;
  password?: string;
  /**
   * Legacy single provider subject. Google and OIDC both wrote it, so it is no
   * longer written; OIDC login still reads it once and moves it into identities.
   */
  sub?: string;
  picture?: string;
  role: 'user' | 'admin';
  isVerified: boolean;
  verificationToken?: string;
  refreshToken?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  lastLogin: Date;
  /** Workspace used when a request sends no X-Workspace-Id (set lazily to the personal one). */
  defaultWorkspaceId?: Types.ObjectId | null;
  locale?: string | null;
  /** false once deprovisioned (SCIM). */
  active: boolean;
  identities: Types.DocumentArray<IUserIdentity & Document>;
  /** Set when the account is managed by a workspace's SCIM client. */
  scim?: { externalId?: string; workspaceId?: Types.ObjectId } | null;
  deletionRequestedAt?: Date | null;
  deletedAt?: Date | null;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserIdentitySchema = new Schema<IUserIdentity>(
  {
    provider: { type: String, enum: IDENTITY_PROVIDERS, required: true },
    connectionId: { type: Schema.Types.ObjectId, default: null },
    subject: { type: String, required: true },
  },
  { _id: false },
);

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  password: { type: String, select: false },
  sub: { type: String, unique: true, sparse: true },
  picture: { type: String },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String, select: false },
  refreshToken: { type: String, select: false },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },
  lastLogin: { type: Date, default: Date.now },
  defaultWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
  locale: { type: String, default: null },
  active: { type: Boolean, default: true },
  identities: { type: [UserIdentitySchema], default: [] },
  scim: {
    type: new Schema({ externalId: String, workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' } }, { _id: false }),
    default: null,
  },
  deletionRequestedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

UserSchema.index({ 'identities.provider': 1, 'identities.subject': 1 });

// Hash password before saving
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error: any) {
    throw error;
  }
});

UserSchema.methods.comparePassword = async function (candidatePassword: string) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);
