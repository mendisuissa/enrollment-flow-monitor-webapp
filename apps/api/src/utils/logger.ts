import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { config } from '../config.js';

const logDir = path.dirname(config.logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// The file destination lives under /home, which on Linux App Service is an
// Azure Files (SMB) network share — writes there can stall or error under
// platform load in a way local disk never would. A SonicBoom destination
// that emits an unhandled 'error' crashes the whole process (EventEmitter
// default behavior), so it's caught and reported to stderr instead. stdout
// is kept as the primary sink: Azure Linux captures container stdout/stderr
// directly (visible via `az webapp log tail`) regardless of this file and
// regardless of the Application Logging toggle, which does not apply to
// Linux App Service — so crash evidence survives even if the file write does not.
const fileDestination = pino.destination({ dest: config.logFile, sync: false });
fileDestination.on('error', (err) => {
  process.stderr.write(`[logger] file destination error (continuing on stdout only): ${err?.stack ?? err}\n`);
});

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.multistream([
    { stream: process.stdout },
    { stream: fileDestination }
  ])
);

export const requestLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
