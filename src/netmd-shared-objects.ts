// https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
// I could have used the make-error library
export class NetMDError extends Error {
    constructor(m: string) {
        super(m);
        Object.setPrototypeOf(this, NetMDError.prototype);
    }
}
export class NetMDNotImplemented extends NetMDError {
    constructor(m: string) {
        super(m);
        Object.setPrototypeOf(this, NetMDNotImplemented.prototype);
    }
}
export class NetMDRejected extends NetMDError {
    constructor(m: string) {
        super(m);
        Object.setPrototypeOf(this, NetMDRejected.prototype);
    }
}

export enum Status {
    // NetMD Protocol return status (first byte of request)
    control = 0x00,
    status = 0x01,
    specificInquiry = 0x02,
    notify = 0x03,
    generalInquiry = 0x04,
    //  ... (first byte of response)
    notImplemented = 0x08,
    accepted = 0x09,
    rejected = 0x0a,
    inTransition = 0x0b,
    implemented = 0x0c,
    changed = 0x0d,
    interim = 0x0f,
}
