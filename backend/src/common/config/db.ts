import mongoose from 'mongoose';
import dns from 'node:dns';
import { env } from './env';

// Some Windows/ISP DNS servers fail MongoDB Atlas SRV lookups. Overriding the
// resolver process-wide breaks corporate/internal hostnames, so it's opt-in.
// Set FORCE_PUBLIC_DNS=true only when the local resolver can't handle SRV.
if (env.FORCE_PUBLIC_DNS) {
  try {
    dns.setDefaultResultOrder('ipv4first');
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch {
    // Ignore if environment overrides DNS configuration
  }
}

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.MONGO_URI);
    console.log(`[MongoDB] Connected: ${conn.connection.host} 🍃`);
  } catch (error) {
    console.error(`[MongoDB] Connection Error:`, error);
    process.exit(1);
  }
};