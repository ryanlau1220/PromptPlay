FROM node:24-bookworm-slim
RUN npm install -g pnpm@12.16.1 bun@1.3.10
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
ENV HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/data/promptplay.sqlite
EXPOSE 3001
CMD ["bun", "src/index.ts"]
