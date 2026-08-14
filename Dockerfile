# syntax=docker/dockerfile:1

FROM node:22-alpine AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM alpine:3.24 AS runtime

RUN apk add --no-cache libstdc++ \
    && addgroup --gid 1000 --system node \
    && adduser --uid 1000 --system --ingroup node node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3030

WORKDIR /app

COPY --from=production-dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src

USER node

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3030/health || exit 1

CMD ["node", "src/server.js"]
