# HuggingFace Spaces - Reality Engine deployment
FROM node:18-slim

RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /app

COPY --chown=user package.json package-lock.json* ./

RUN npm ci

COPY --chown=user . .

RUN npm run build

EXPOSE 7860

CMD ["sh", "-c", "node server/signalling-server.js & npx vite preview --host 0.0.0.0 --port 7860"]
