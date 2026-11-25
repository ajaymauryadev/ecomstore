FROM node:24-bookworm-slim AS client
WORKDIR /build
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ENV VITE_API_URL=/api/v1 VITE_WS_URL="" VITE_DISABLE_WEBSOCKETS=false
RUN npm run build

FROM caddy:2.11.9-alpine AS caddy

FROM node:24-bookworm-slim AS runtime
WORKDIR /opt/smart-kirana
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir -p /srv/smart-kirana/uploads /srv/client /etc/caddy \
    && chown -R node:node /srv/smart-kirana
COPY server/server.js ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY --from=client /build/dist/ /srv/client/
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY deploy/northflank/Caddyfile /etc/caddy/Caddyfile
COPY deploy/northflank/start.sh ./start.sh
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh
ENV NODE_ENV=production PORT=5000 TRUSTED_PROXY_CIDRS=127.0.0.1/32 \
    SMART_KIRANA_UPLOADS_ROOT=/srv/smart-kirana/uploads IMAGE_STORAGE=imagekit
USER node
EXPOSE 8080
CMD ["/bin/bash", "./start.sh"]
