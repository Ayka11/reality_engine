# Hugging Face Spaces Docker deployment
FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build
ENV PORT=7860
EXPOSE 7860
CMD ["node", "server/hf-server.js"]
