FROM node:20-alpine

# Install OpenSSL (required for Prisma)
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Copy Prisma schema BEFORE installing dependencies
COPY prisma ./prisma

# Install production dependencies
# This will run postinstall hook which runs prisma generate
RUN npm ci --omit=dev && npm cache clean --force

# Remove Shopify CLI (not needed in production)
RUN npm remove @shopify/cli || true

# Copy rest of application
COPY . .

# Build the application
RUN npm run build

# Expose port (Railway uses PORT env variable, default 8080)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start command: Run migrations then start server
CMD npx prisma migrate deploy && npm run docker-start
