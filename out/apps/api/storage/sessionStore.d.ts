import session, { Store } from 'express-session';
export declare class PrismaSessionStore extends Store {
    private cleanupInterval;
    constructor();
    get(sid: string, callback: (err: any, session?: session.SessionData | null) => void): void;
    set(sid: string, session: session.SessionData, callback?: (err?: any) => void): void;
    destroy(sid: string, callback?: (err?: any) => void): void;
    touch(sid: string, session: session.SessionData, callback?: (err?: any) => void): void;
}
