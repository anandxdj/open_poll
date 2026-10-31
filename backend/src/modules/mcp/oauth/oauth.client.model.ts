import mongoose, { Schema, type Document } from 'mongoose';

/**
 * An OAuth client registered through dynamic client registration (RFC 7591):
 * Claude, ChatGPT, an IDE. Anyone may register, so a client is untrusted
 * until a user approves it on the consent page, and unused clients expire.
 * A confidential client's secret is stored as a sha256 hash, like tokens.
 */
export interface IOAuthClient extends Document {
  clientId: string;
  clientSecretHash: string | null;
  /** The registered metadata (redirect_uris, client_name, ...), as validated by the SDK schema. */
  metadata: Record<string, unknown>;
  clientIdIssuedAt: number;
  /** Pushed forward on every token request; the TTL index removes clients nobody uses. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const oauthClientSchema = new Schema<IOAuthClient>(
  {
    clientId: { type: String, required: true, unique: true },
    clientSecretHash: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, required: true },
    clientIdIssuedAt: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

oauthClientSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OAuthClientModel = mongoose.model<IOAuthClient>('OAuthClient', oauthClientSchema);
