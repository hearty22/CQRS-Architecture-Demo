# Node 24 y no 26 a proposito: Prisma 7.10 declara soporte hasta 24.0+ y
# avisa por consola si corre en Node 26.
FROM node:24-alpine

# pnpm via npm global. Node 24+ ya no incluye corepack, asi que el clasico
# `corepack enable && corepack prepare pnpm@latest` falla con "not found".
RUN npm install -g pnpm@11.10.0

WORKDIR /app

# Capa de dependencias: se invalida solo si cambian estos tres archivos.
# allowBuilds (en pnpm-workspace.yaml) es lo que permite los postinstall de
# Prisma y esbuild en pnpm 11.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000

# El client generado vive en src/generated, que esta gitignored y ademas
# queda tapado por el bind mount de /app en compose. Por eso se genera en
# cada arranque y no en el build de la imagen.
#
# `migrate deploy` es idempotente: aplica lo pendiente y sale.
CMD ["sh", "-c", "pnpm prisma generate && pnpm prisma:migrate && pnpm dev"]
