/**
 * Runs before any test file (bunfig.toml). `common/config/env` and the shared
 * Redis client read MONGO_URI/REDIS_URL once, on first import, so integration
 * suites can only reach the dedicated test services if the URLs are swapped
 * here, before anything imports them. Unit tests stub Mongo and Redis and
 * never connect, so the swap does not change them.
 */
if (process.env.TEST_MONGO_URI) process.env.MONGO_URI = process.env.TEST_MONGO_URI;
if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;
