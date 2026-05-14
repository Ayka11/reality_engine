# HuggingFace Spaces - Reality Engine deployment
FROM node:18-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Expose ports
EXPOSE 3000 8888

# Start both signalling server and Vite preview
CMD ["sh", "-c", "node server/signalling-server.js & npx vite preview --host 0.0.0.0 --port 3000"]
