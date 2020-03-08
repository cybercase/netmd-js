/* A bunch of utils. Some might be unused */

export async function sleep(msec: number) {
    await new Promise(resolve => setTimeout(resolve, msec));
}

export function withTimeout<T>(timeoutInMs: number, cb: () => T): Promise<T> {
    return new Promise(async (resolve, reject) => {
        // Start the timer
        let timer = setTimeout(() => {
            reject(new Error(`Operation timed out`));
        }, timeoutInMs);

        let result = await cb();

        clearTimeout(timer);

        resolve(result);
    });
}

export function assert(condition: boolean, message?: string) {
    if (condition) {
        return;
    }
    message = message || 'no message provided';
    throw new Error(`Assertion failed: ${message}`);
}

export function assertBigInt(value: unknown, message?: string): bigint {
    if (typeof value === 'bigint') {
        return value as bigint;
    }
    throw assert(false, `Expected BigInt type - ${message}`);
}

export function assertNumber(value: unknown, message?: string): number {
    if (typeof value === 'number') {
        return value as number;
    }
    throw assert(false, `Expected number type - ${message}`);
}

export function assertString(value: unknown, message?: string): string {
    if (typeof value === 'string') {
        return value as string;
    }
    throw assert(false, `Expected string type - ${message}`);
}

export function stringToCharCodeArray(str: string) {
    let result = new Array(str.length);
    for (let i = 0; i < str.length; i++) {
        result[i] = str.charCodeAt(i);
    }
    return result;
}

// compare ArrayBuffers
export function arrayBuffersAreEqual(a: ArrayBuffer, b: ArrayBuffer) {
    return dataViewsAreEqual(new DataView(a), new DataView(b));
}

// compare DataViews
export function dataViewsAreEqual(a: DataView, b: DataView) {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
        if (a.getUint8(i) !== b.getUint8(i)) return false;
    }
    return true;
}

// Thanks to https://gist.github.com/TooTallNate/4750953
export function isBigEndian() {
    return new Uint8Array(new Uint32Array([0x12345678]).buffer)[0] === 0x12;
}

export function hexEncode(str: string) {
    let hex;
    let result = '';
    for (let i = 0; i < str.length; i++) {
        hex = str.charCodeAt(i).toString(16);
        result += ('0' + hex).slice(-2);
    }

    return result;
}

export function arrayBufferToBinaryString(ab: ArrayBuffer) {
    let src = new Uint8Array(ab);
    return uint8arrayToBinaryString(src);
}

export function uint8arrayToBinaryString(u8a: Uint8Array) {
    let dst = Array(u8a.length);
    u8a.forEach((c, i) => (dst[i] = String.fromCharCode(c)));
    return dst.join('');
}

export function concatUint8Arrays(...args: Uint8Array[]) {
    let totalLength = 0;
    for (let a of args) {
        totalLength += a.length;
    }

    let res = new Uint8Array(totalLength);

    let offset = 0;
    for (let a of args) {
        res.set(a, offset);
        offset += a.length;
    }
    return res;
}

export function concatArrayBuffers(buffer1: ArrayBuffer, buffer2: ArrayBuffer) {
    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
}

// Thanks to: https://gist.github.com/artjomb/7ef1ee574a411ba0dd1933c1ef4690d1
function wordToByteArray(word: number, length: number) {
    let ba = [],
        xFF = 0xff;
    if (length > 0) ba.push(word >>> 24);
    if (length > 1) ba.push((word >>> 16) & xFF);
    if (length > 2) ba.push((word >>> 8) & xFF);
    if (length > 3) ba.push(word & xFF);
    return ba;
}

export function wordArrayToByteArray(wordArray: any, length: number = wordArray.sigBytes) {
    let res = new Uint8Array(length);
    let bytes;
    let i = 0;
    let offset = 0;
    while (length > 0) {
        bytes = wordToByteArray(wordArray.words[i], Math.min(4, length));
        res.set(bytes, offset);
        length -= bytes.length;
        offset += bytes.length;
        i++;
    }
    return res;
}

export function timeToFrames(time: number[]) {
    assert(time.length === 4);
    return ((time[0] * 60 + time[1]) * 60 + time[2]) * 512 + time[3];
}

export function pad(str: string | number, pad: string) {
    return (pad + str).slice(-pad.length);
}

export function formatTimeFromFrames(value: number) {
    let f = value % 512;
    value = (value - f) / 512; // sec

    let s = value % 60;
    value = (value - s) / 60; // min

    let m = value % 60;
    value = (value - m) / 60; // hour

    let h = value;

    return `${pad(h, '00')}:${pad(m, '00')}:${pad(s, '00')}+${pad(f, '000')}`;
}

export function sanitizeTrackTitle(title: string) {
    return encodeURIComponent(title);
}
