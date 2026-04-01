FROM oven/bun:1.2

WORKDIR /app

COPY package.json bun.lock ./
COPY src-react/package.json ./src-react/package.json
RUN bun install

COPY src-ts/package.json src-ts/bun.lock ./src-ts/
RUN cd src-ts && bun install

COPY . .

RUN mkdir -p /data /app/data && chmod -R 777 /data /app/data
RUN cd src-react && bun run build

ENV PORT=3000
ENV HOST=0.0.0.0
ENV APP_DATA_DIR=/data
ENV OPENPCB_ALLOW_UNAUTHENTICATED_API=true
ENV OPENPCB_STARTUP_LICENSE_STATE=active
ENV OPENPCB_STARTUP_LICENSE_CODE=DOCKER_ACTIVE
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "src-ts/src/main.ts"]
