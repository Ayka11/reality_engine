# HuggingFace Spaces - Reality Engine deployment
FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 7860

CMD ["sh", "-c", "node server/signalling-server.js & npx vite preview --host 0.0.0.0 --port 7860"]
