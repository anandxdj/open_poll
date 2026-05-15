# Use the official Bun image
FROM oven/bun:latest

# Set the working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Expose the backend port
EXPOSE 5000

# Healthcheck to monitor backend status
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:5000/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

# Start the application
CMD ["bun", "run", "start"]
