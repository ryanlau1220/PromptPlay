FROM oven/bun:1.3.10-slim@sha256:5d5863f35ad9b3acceee8dc134fb2b89f07831129eaeec81af2b19a23dabe3e0
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN bun install --frozen-lockfile
COPY apps/web ./apps/web
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["bun", "run", "dev", "--host", "0.0.0.0"]
