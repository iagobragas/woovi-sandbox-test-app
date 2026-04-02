const http = require('node:http');
const path = require('node:path');
const { createApp } = require('./lib/app');

const env = loadEnv(path.join(__dirname, '.env'));
const PORT = Number(env.PORT || 3000);
const HOST = env.HOST || '127.0.0.1';

const app = createApp({ baseDir: __dirname });
const server = http.createServer(app.handleNodeRequest);

server.listen(PORT, HOST, () => {
  console.log(`Woovi sandbox app running at http://${HOST}:${PORT}`);
});

function loadEnv(filePath) {
  const fs = require('node:fs');
  const loaded = {};

  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      loaded[key] = value;
    }
  }

  return {
    ...loaded,
    ...process.env,
  };
}
