# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn \
    VIDEO_CREATOR_FFMPEG=ffmpeg \
    VIDEO_CREATOR_FFPROBE=ffprobe

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      espeak-ng \
      ffmpeg \
      fontconfig \
      fonts-dejavu-core \
      fonts-nanum \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY . .
RUN mkdir -p out \
    && chown -R node:node /app

USER node

CMD ["node", "run.js", "--mock"]
