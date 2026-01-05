FROM node:20-alpine

# Required for Prisma + Shopify crypto
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

EXPOSE 3000

# 1. Copy package files first (Docker cache optimization)
COPY package.json package-lock.json* ./

# 2. 🔑 Copy Prisma schema BEFORE npm install
COPY prisma ./prisma

# 3. Install dependencies (postinstall -> prisma generate will now work)
RUN npm ci --omit=dev && npm cache clean --force

# 4. Remove Shopify CLI (not needed in production)
RUN npm remove @shopify/cli

# 5. Copy the rest of the application
COPY . .

# 6. Build the app
RUN npm run build

# 7. Start the app
CMD ["npm", "run", "docker-start"]
