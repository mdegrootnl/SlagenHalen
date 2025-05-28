# Stage 1: Install dependencies and build the application
FROM node:20-alpine AS base

# Install git
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Define repository URL as a build argument (can be overridden)
ARG REPO_URL=https://github.com/mdegrootnl/SlagenHalen.git
ARG REPO_BRANCH=main # Or your desired default branch

# Clone the repository
RUN git clone --branch $REPO_BRANCH $REPO_URL .
# If you need a specific commit or tag, you can add:
# RUN git checkout <your-tag-or-commit-sha>

# Install pnpm (can be done before or after clone, but git is needed first for cloning)
RUN npm install -g pnpm

# Now that code is cloned, package.json and pnpm-lock.yaml are from the repo
# Install dependencies
RUN pnpm install --frozen-lockfile

# At this point, all source code including server.ts, next.config.ts etc.,
# are from the cloned repository.
# The .dockerignore file in your local workspace will NOT affect this git clone.
# The repository itself should have a .gitignore file to manage what's committed.

# Provide POSTGRES_URL for the build stage
# This is needed if the Next.js build process checks for this variable.
# The value used here is a placeholder for build time.
# The actual runtime POSTGRES_URL is injected by docker-compose.
ARG POSTGRES_URL_BUILD_TIME="postgresql://builduser:buildpass@localhost:5432/builddb"
ENV POSTGRES_URL=${POSTGRES_URL_BUILD_TIME}

# Provide AUTH_SECRET for the build stage if middleware/auth logic runs during build
ARG AUTH_SECRET_BUILD_TIME="vGYKkvA2NqDuWVjROsfS/h6wYIMSIO90vezSSkXdYm4=" # Updated with generated key
ENV AUTH_SECRET=${AUTH_SECRET_BUILD_TIME}

# Clean .next directory before build to ensure a fresh build
RUN rm -rf .next

# Build the Next.js application
RUN pnpm run build

# Stage 2: Production image - smaller and more secure
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm and tsx
RUN npm install -g pnpm tsx

# Copy built assets and necessary files from the 'base' stage
# These files (package.json, server.ts, etc.) originally came from the cloned repo in the 'base' stage
COPY --from=base /app/.next ./.next
COPY --from=base /app/public ./public
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/server.ts ./server.ts
COPY --from=base /app/next.config.ts ./next.config.ts
COPY --from=base /app/tsconfig.json ./tsconfig.json
COPY --from=base /app/lib ./lib

# Expose the port the app runs on
EXPOSE 3001

# Set environment variables for runtime
ENV NODE_ENV=production
# The actual POSTGRES_URL for runtime will be supplied by docker-compose.yml
# However, if running this image directly without docker-compose, you might want to set it here
# or ensure it's passed in the `docker run` command.
# ENV POSTGRES_URL= # Intentionally left blank or set to a default if needed for direct runs

# Command to run the application
# The start script in package.json is "NODE_ENV=production tsx server.ts"
# pnpm start will execute this.
CMD ["pnpm", "start"] 