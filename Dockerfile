FROM oven/bun:alpine AS base
WORKDIR /app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .
RUN bun run build

FROM base AS release
COPY --from=prerelease /app/dist ./dist
COPY --from=prerelease /app/package.json .
RUN mkdir -p /app/data && chown -R bun:bun /app/data

USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "start" ]
