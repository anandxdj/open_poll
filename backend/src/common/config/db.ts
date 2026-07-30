import mongoose from 'mongoose';
import dns from 'node:dns';

// Some Windows/ISP DNS servers fail MongoDB Atlas SRV lookups. Overriding the
// resolver process-wide breaks corporate/internal hostnames, so it's opt-in.
// Set FORCE_PUBLIC_DNS=true only when the local resolver can't handle SRV.
if (process.env.FORCE_PUBLIC_DNS === 'true') {
  try {
    dns.setDefaultResultOrder('ipv4first');
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch {
    // Ignore if environment overrides DNS configuration
  }
}

export const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
      throw new Error("MONGO_URI is missing in .env file");
    }

    const conn = await mongoose.connect(mongoURI);
    console.log(`[MongoDB] Connected: ${conn.connection.host} 🍃`);
  } catch (error) {
    console.error(`[MongoDB] Connection Error:`, error);
    process.exit(1);
  }
};