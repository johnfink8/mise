FROM node:24-slim
WORKDIR /app
COPY server.js seed.json ./
EXPOSE 8421
HEALTHCHECK --interval=2s --timeout=2s --retries=10 \
  CMD node -e "require('http').get('http://127.0.0.1:8421/identity',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
