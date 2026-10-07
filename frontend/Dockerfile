FROM node:24-alpine

# Node 24+ ya no incluye corepack; pnpm se instala con npm.
RUN npm install -g pnpm@11.10.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173

CMD ["pnpm", "dev"]
