# HuggingFace Spaces - Reality Engine deployment
FROM node:18-slim

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

RUN npm install -g serve

EXPOSE 7860

CMD ["sh", "-c", "node server/signalling-server.js & serve dist -p 7860"]
