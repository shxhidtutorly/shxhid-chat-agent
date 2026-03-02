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

# Railway handles health checks via healthcheckPath in railway.json.
# Do NOT add Docker HEALTHCHECK — it conflicts with Railway's orchestrator.

# Start command: Run migrations then start server
CMD npx prisma migrate deploy && npm run docker-start
