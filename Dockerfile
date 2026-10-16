FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs community-server.mjs auth-server.mjs server-clock.mjs ./
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=4173
EXPOSE 4173
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
