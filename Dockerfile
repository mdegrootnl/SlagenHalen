# Use the official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Install git to clone the repository
RUN apk add --no-cache git

# Clone the repository
RUN git clone https://github.com/mdegrootnl/SlagenHalen.git .

# Install pnpm and dependencies globally
RUN npm install -g pnpm tsx

# Install project dependencies
RUN pnpm install

# Clean any existing build artifacts and cache
RUN rm -rf .next
RUN pnpm store prune

# Build the Next.js application (with dummy env vars for build)
ENV SKIP_ENV_VALIDATION=true
ENV POSTGRES_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN pnpm build

# Remove build-time environment variables
ENV POSTGRES_URL=""

# Expose the ports the app runs on
EXPOSE 3000 3001

# Set environment variables for runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV SOCKET_PORT=3001

# Start both Next.js and Socket.IO servers
CMD ["sh", "-c", "pnpm start & tsx socket-server.ts & wait"] 