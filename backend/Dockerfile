FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY migrations ./migrations
COPY .sequelizerc ./.sequelizerc
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/server.js"]
