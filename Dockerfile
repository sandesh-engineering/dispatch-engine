# BASE STAGE
FROM node:22-alpine AS base

WORKDIR /app

# Manages package managers like PNPM or Yarn
RUN corepack enable 


# PRUNER STAGE
FROM base AS pruner

COPY . .

# Structure the output specifically for the docker layer caching
RUN pnpm dlx turbo prune dispatch-engine --docker


# INSTALLER STAGE
FROM base AS installer

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --frozen-lockfile


# BUILDER STAGE
FROM installer AS builder

# Copy only required files
COPY --from=pruner /app/out/full/ .

# Build dispatch-engine and its workspace dependencies
RUN pnpm turbo build --filter=dispatch-engine

# Create a standalone production deployment
RUN pnpm --filter=dispatch-engine deploy --prod /prod/dispatch-engine


# RUNNER STAGE
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production  

# Install dumb-init for proper signal handling (Proper process id 1 handling)
RUN apk add --no-cache dumb-init

# Create non-root group
RUN addgroup -g 1001 -S appgroup

# Create non-root user
RUN adduser -S -u 1001 -G appgroup appuser

# Copy only from deployed output
COPY --from=builder /prod/dispatch-engine ./

# As winston is setup to write in FS and no writes are enabled for the non-root user so we are enabling this
RUN mkdir -p /app/logs && chown -R 1001:1001 /app/logs

# Switch to non-root user
USER 1001:1001

EXPOSE 5010

# Graceful shutdown support
ENTRYPOINT ["dumb-init", "--"]

# We need to include the migrations script too.
CMD ["node", "dist/index.js"]
