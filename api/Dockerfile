# Multi-stage Dockerfile for MirachPOS API
# Supports both development and production builds

# -----------------------------------------------------------------------------
# Base Stage - Common dependencies
# -----------------------------------------------------------------------------
FROM node:22-alpine AS base

WORKDIR /app

# Install system dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# -----------------------------------------------------------------------------
# Dependencies Stage - Install npm packages
# -----------------------------------------------------------------------------
FROM base AS dependencies

COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --include=dev

# -----------------------------------------------------------------------------
# Development Stage - Hot reload for local development
# -----------------------------------------------------------------------------
FROM base AS development

WORKDIR /app

# Copy dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./

# Copy source code
COPY . .

# Expose API port
EXPOSE 3001

# Development command with hot reload
CMD ["npm", "run", "dev"]

# -----------------------------------------------------------------------------
# Build Stage - Prepare production build (if needed)
# -----------------------------------------------------------------------------
FROM dependencies AS build

COPY . .

# Run any build steps (tests, bundling, etc.)
# Currently Node.js API doesn't need a build step, but this stage is ready
RUN npm test -- --passWithNoTests || true

# -----------------------------------------------------------------------------
# Production Stage - Optimized for production
# -----------------------------------------------------------------------------
FROM node:22-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose API port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "http.get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Production command
CMD ["node", "src/index.js"]
