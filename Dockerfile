FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY index.html privacy.html stats.html ./
COPY examples ./examples
COPY scripts ./scripts
COPY src ./src

ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
