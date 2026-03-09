import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { config } from '../config.js';

const logDir = path.dirname(config.logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info'
}, pino.destination(config.logFile));

export const requestLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
