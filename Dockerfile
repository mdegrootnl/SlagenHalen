# Use the official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Clone the repository
RUN apk add --no-cache git
RUN git clone https://github.com/Werk-AI/saas-starter.git .

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install

# Build the Next.js application
RUN pnpm build

# Copy environment file
COPY .env .env

# Expose the ports the app runs on
EXPOSE 3000 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV SOCKET_PORT=3001

# Start both Next.js and Socket.IO servers
CMD ["pnpm", "start:production"] 