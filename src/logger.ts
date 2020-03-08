export interface Logger {
    debug: (...args: any) => void;
    info: (...args: any) => void;
    warn: (...args: any) => void;
    error: (...args: any) => void;
    child: (ctx: object) => Logger;
}

export enum Level {
    error = 0,
    warn = 1,
    info = 2,
    debug = 3,
}

export class ConsoleLogger {
    constructor(public level: Level = Level.info, public ctx: object = {}) {}

    debug(...args: any) {
        if (this.level >= Level.debug) {
            console.log(...args);
        }
    }

    info(...args: any) {
        if (this.level >= Level.info) {
            console.log(...args);
        }
    }

    warn(...args: any) {
        if (this.level >= Level.warn) {
            console.log(...args);
        }
    }

    error(...args: any) {
        if (this.level >= Level.error) {
            console.log(...args);
        }
    }

    child(ctx: object) {
        return new ConsoleLogger(this.level, { ...this.ctx, ...ctx });
    }
}
