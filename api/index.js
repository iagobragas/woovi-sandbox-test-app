const path = require('node:path');
const { createApp } = require('../lib/app');

const app = createApp({ baseDir: path.join(__dirname, '..') });

module.exports = (req, res) => app.handleVercelRequest(req, res);
