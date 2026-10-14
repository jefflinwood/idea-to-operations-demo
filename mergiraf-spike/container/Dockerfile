FROM --platform=linux/amd64 node:22-slim

ARG MERGIRAF_VERSION=0.20.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL "https://codeberg.org/mergiraf/mergiraf/releases/download/v${MERGIRAF_VERSION}/mergiraf_x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xz -C /usr/local/bin mergiraf \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install --omit=dev --no-audit --no-fund typescript@5 @types/node@22
COPY server.mjs .

EXPOSE 8080
CMD ["node", "server.mjs"]
