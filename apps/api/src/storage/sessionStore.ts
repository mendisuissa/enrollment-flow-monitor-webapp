import session, { Store } from 'express-session';
import { prisma } from './prisma.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type Row = { data: string; expiresAt: string };

export class PrismaSessionStore extends Store {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    // Prune expired sessions every hour
    this.cleanupInterval = setInterval(() => {
      prisma.$executeRawUnsafe('DELETE FROM "Session" WHERE expiresAt <= datetime("now")')
        .catch(() => {});
    }, 60 * 60 * 1000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void): void {
    prisma.$queryRawUnsafe<Row[]>(
      'SELECT data, expiresAt FROM "Session" WHERE id = ?', sid
    ).then(rows => {
      const row = rows[0];
      if (!row) return callback(null, null);
      if (new Date(row.expiresAt) < new Date()) {
        prisma.$executeRawUnsafe('DELETE FROM "Session" WHERE id = ?', sid).catch(() => {});
        return callback(null, null);
      }
      try { callback(null, JSON.parse(row.data)); }
      catch { callback(null, null); }
    }).catch(err => callback(err));
  }

  set(sid: string, session: session.SessionData, callback?: (err?: any) => void): void {
    const maxAge = (session as any).cookie?.maxAge;
    const ttl = typeof maxAge === 'number' && maxAge > 0 ? maxAge * 1000 : TTL_MS;
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    const data = JSON.stringify(session);

    prisma.$executeRawUnsafe(
      `INSERT INTO "Session" (id, data, expiresAt, updatedAt)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, expiresAt = excluded.expiresAt, updatedAt = datetime('now')`,
      sid, data, expiresAt
    ).then(() => callback?.()).catch(err => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    prisma.$executeRawUnsafe('DELETE FROM "Session" WHERE id = ?', sid)
      .then(() => callback?.()).catch(() => callback?.());
  }

  touch(sid: string, session: session.SessionData, callback?: (err?: any) => void): void {
    const maxAge = (session as any).cookie?.maxAge;
    const ttl = typeof maxAge === 'number' && maxAge > 0 ? maxAge * 1000 : TTL_MS;
    const expiresAt = new Date(Date.now() + ttl).toISOString();

    prisma.$executeRawUnsafe(
      'UPDATE "Session" SET expiresAt = ?, updatedAt = datetime(\'now\') WHERE id = ?',
      expiresAt, sid
    ).then(() => callback?.()).catch(() => callback?.());
  }
}
