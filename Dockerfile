FROM node:24.21.0-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY contracts ./contracts
COPY public ./public
COPY scripts ./scripts
COPY src ./src

RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV HOST=0.0.0.0 PORT=3800 DATABASE_PATH=/app/data/shooting-operations.sqlite UPLOAD_ROOT=/app/data/uploads
EXPOSE 3800
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3800/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
