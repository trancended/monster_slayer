# ─────────────────────────────────────────────────────────────────────────────
# Monster Slayer — klient przeglądarkowy.
# Dwa cele: `dev` (Vite z HMR, port 5173) i `prod` (statyczny build za nginx).
# Host nie potrzebuje ani Node'a, ani pnpm — wszystko żyje w obrazie.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Warstwa zależności — cache'owana dopóki nie zmienią się manifesty.
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/client/package.json packages/client/
COPY packages/sim/package.json packages/sim/
RUN pnpm install --frozen-lockfile=false

# ── dev: serwer Vite z HMR, źródła montowane bind-mountem z hosta
FROM deps AS dev
COPY . .
ENV VITE_USE_POLLING=true
EXPOSE 5173
CMD ["pnpm", "--filter", "@ms/client", "dev"]

# ── build produkcyjny
FROM deps AS build
COPY . .
RUN pnpm --filter @ms/client build

# ── prod: statyki za nginx, zero Node'a w runtime
FROM nginx:1.27-alpine AS prod
COPY --from=build /app/packages/client/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
