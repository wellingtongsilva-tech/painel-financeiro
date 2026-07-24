# SQLite nativo do Node (node:sqlite) — sem compilação de módulo nativo
FROM node:24-alpine

WORKDIR /app

# Instala só dependências de produção (todas pure-JS)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Banco persistido em volume
VOLUME ["/app/data"]

# Healthcheck interno do container
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
