# MCP server (stdio) for ar-data-agent.
# Free tools work with no configuration. Paid tools need AR_AGENT_PRIVATE_KEY
# (a funded Celo wallet you control); see README.md.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY mcp ./mcp
COPY scripts ./scripts
COPY src ./src
ENV NODE_ENV=production
ENTRYPOINT ["node", "mcp/server.js"]
