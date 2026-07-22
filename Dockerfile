# syntax=docker/dockerfile:1

# Multi-stage build: Next.js `output: standalone` self-hosted on a
# Playwright base image (Playwright over Puppeteer — see design.md →
# "Architecture Decisions"). The `playwright` npm dependency version in
# package.json MUST match this base image tag exactly.

# ---- deps: install dependencies only (cached separately from source) ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- builder: compile the Next.js standalone build ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: official Playwright image (Chromium + OS deps preinstalled) ----
FROM mcr.microsoft.com/playwright:v1.61.1-noble AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
