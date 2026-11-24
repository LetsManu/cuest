# Build from the repository root:  docker build -t cuest-server -f server/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci
COPY server/ server/
RUN npm run build -w server

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
RUN mkdir -p /data && chown node:node /data
ENV CUEST_DATA_DIR=/data
VOLUME /data
EXPOSE 8787
USER node
WORKDIR /app/server
CMD ["node", "--no-warnings", "dist/main.js"]
