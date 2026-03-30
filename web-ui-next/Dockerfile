# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY web-ui-next/package*.json ./
RUN npm ci

# Copy proto definitions and generate TypeScript
COPY proto/ /proto/
COPY web-ui-next/buf.gen.yaml ./
RUN npx buf generate /proto

# Copy source
COPY web-ui-next/ .

# Build Next.js app (standalone output)
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

CMD ["node", "server.js"]
