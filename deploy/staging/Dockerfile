FROM node:24-bookworm-slim AS api
WORKDIR /opt/smart-kirana
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir -p /srv/smart-kirana/uploads && chown -R node:node /srv/smart-kirana
COPY server/server.js ./server.js
COPY server/src ./src
COPY server/scripts ./scripts
USER node
ENV NODE_ENV=production PORT=5000 SMART_KIRANA_UPLOADS_ROOT=/srv/smart-kirana/uploads
CMD ["node", "server.js"]

FROM node:24-bookworm-slim AS client
WORKDIR /build
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ .
ENV VITE_API_URL=/api/v1 VITE_WS_URL=""
RUN npm run build

FROM caddy:2.11.9-alpine AS edge
ARG CADDYFILE=deploy/staging/Caddyfile
COPY ${CADDYFILE} /etc/caddy/Caddyfile
COPY --from=client /build/dist/ /srv/
