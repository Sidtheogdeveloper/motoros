FROM node:24-alpine
RUN apk add --no-cache aws-cli postgresql-client ca-certificates && apk upgrade --no-cache
RUN rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY infrastructure/scripts ./infrastructure/scripts
COPY infrastructure/docker/rds-ca.pem /app/rds-ca.pem
USER node
VOLUME ["/tmp"]
ENTRYPOINT ["node","infrastructure/scripts/initialize-runtime.mjs"]
