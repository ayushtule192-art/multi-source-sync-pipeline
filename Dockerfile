FROM node:18-alpine

WORKDIR /usr/src/app

# Copy dependency files first for better Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy source and build
COPY . .
RUN npm run build

# Remove dev source, only keep compiled output
EXPOSE 3000

# Run compiled JS directly (faster than ts-node in production)
CMD ["node", "dist/src/index.js"]
