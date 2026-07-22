# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Install ALL deps (including dev) so we have tsc available
COPY package*.json ./
RUN npm install

# Copy source and compile TypeScript → dist/
COPY . .
RUN npm run build

# ── Stage 2: Run ────────────────────────────────────────────────
FROM node:18-alpine AS runner

WORKDIR /usr/src/app

# Copy only production deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled output from builder stage
# dist/ contains both dist/src/ and dist/knexfile.js
COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 3000

# Run compiled JS directly (no ts-node needed in production)
CMD ["node", "dist/src/index.js"]
