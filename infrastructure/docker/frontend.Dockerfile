FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
COPY apps/workshop-dashboard/package.json ./apps/workshop-dashboard/package.json
RUN npm ci
COPY apps ./apps
COPY packages/api-contracts ./packages/api-contracts
RUN npm run build
FROM node:24-alpine
RUN addgroup -S motoros && adduser -S motoros -G motoros
RUN rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=motoros:motoros /app/apps/workshop-dashboard/.next/standalone ./
COPY --from=build --chown=motoros:motoros /app/apps/workshop-dashboard/.next/static ./apps/workshop-dashboard/.next/static
USER motoros
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
VOLUME ["/tmp"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["node","apps/workshop-dashboard/server.js"]
