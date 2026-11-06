FROM oven/bun:1.3.10-slim@sha256:5d5863f35ad9b3acceee8dc134fb2b89f07831129eaeec81af2b19a23dabe3e0
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN bun install --frozen-lockfile
COPY apps/server/src ./apps/server/src
WORKDIR /app/apps/server
ENV HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/data/promptplay.sqlite
EXPOSE 3001
CMD ["bun", "src/index.ts"]
