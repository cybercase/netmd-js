import { assert, assertUint8Array, hexEncode } from './utils';
import JSBI from 'jsbi';

// prettier-ignore
const FORMAT_TYPE_LEN_DICT: { [k: string]: number } = {
    'b': 1, // byte
    'w': 2, // word
    'd': 4, // doubleword
    'q': 8, // quadword
};
/*
    %b, w, d, q - explained above (can have endiannes overriden by '>' and '<' operators, f. ex. %>d %<q)
    %s - Uint8Array preceded by 2 bytes of length
    %x - Uint8Array preceded by 2 bytes of length
    %z - Uint8Array preceded by 1 byte of length
    %* - raw Uint8Array
    %B - BCD-encoded 1-byte number
    %W - BCD-encoded 2-byte number
*/
export function formatQuery(format: string, ...args: unknown[]): ArrayBuffer {
    //console.log("SENT>>> F: ", format);
    let result = [];
    let half: null | string = null;
    let endiannessOverride: null | string = null;
    let argStack = Array.from(args);

    let escaped = false;
    for (let char of format) {
        if (escaped) {
            if (endiannessOverride === null && ['<', '>'].includes(char)) {
                endiannessOverride = char;
                continue;
            }
            escaped = false;
            let value = argStack.shift();
            if (char in FORMAT_TYPE_LEN_DICT) {
                let numberValue = JSBI.BigInt(value as JSBI | number);
                for (let byte = FORMAT_TYPE_LEN_DICT[char] - 1; byte >= 0; byte--) {
                    let b = byte;
                    if (endiannessOverride === '<') {
                        // Use little-endian
                        b = FORMAT_TYPE_LEN_DICT[char] - 1 - byte;
                    }
                    let v = JSBI.signedRightShift(numberValue, JSBI.BigInt(b * 8));
                    v = JSBI.bitwiseAnd(v, JSBI.BigInt(0xff));
                    result.push(JSBI.toNumber(v));
                }
                endiannessOverride = null;
            } else if (char === 'x' || char === 's' || char === 'z') {
                let uint8ArrayValue = assertUint8Array(value);
                let bufferLength = uint8ArrayValue.byteLength;
                if (char === 's') {
                    bufferLength += 1;
                }
                if (char !== 'z') {
                    result.push((bufferLength >> 8) & 0xff);
                }
                result.push(bufferLength & 0xff);
                result.push(...uint8ArrayValue);
                if (char === 's') {
                    result.push(0);
                }
            } else if (char === '*') {
                if (value instanceof Uint8Array) {
                    result.push(...value);
                } else {
                    assert(false, `Unexpected type for value`);
                }
            } else if (char === 'B' || char === 'W') {
                let converted = int2BCD(value as number);
                if (char === 'W') {
                    result.push((converted >> 8) & 0xff);
                }
                result.push(converted & 0xff);
            } else {
                assert(false, `Unrecognized format char ${char}`);
            }
            continue;
        }
        if (char === '%') {
            assert(half === null, `Expected "half" to be null`);
            escaped = true;
            continue;
        }
        if (char === ' ') {
            continue;
        }
        if (half === null) {
            half = char;
        } else {
            result.push(Number.parseInt(half + char, 16));
            half = null;
        }
    }
    return new Uint8Array(result).buffer;
}

export function scanQuery(query: ArrayBuffer | number[] | Uint8Array, format: string) {
    let result: unknown[] = [];
    let inputStack: number[];
    if (query instanceof ArrayBuffer) {
        inputStack = Array.from(new Uint8Array(query));
    } else if (query instanceof Uint8Array) {
        inputStack = Array.from(query);
    } else {
        inputStack = query;
    }
    /*
    console.log("<<<RECV F: ", format);
    let dformat = Array.from(new Uint8Array(query)).map(x => x.toString(16).padStart(2, '0')).join('').split('');
    let n = format.indexOf(' ');
    while(n != -1){
        const partialFormat = format.substring(0, n);
        const amountOfWords = (partialFormat.length - partialFormat.replace("%w", '').length) / 2;
        dformat.splice(n + amountOfWords * 2, 0, ' ');
        n = format.indexOf(' ', n+1);
    }
    console.log("<<<RECV D: ", dformat.join(''));
    */
    let initialLength = inputStack.length;
    let half: string | null = null;
    let endiannessOverride: string | null = null;
    let escaped = false;

    for (let char of format) {
        if (escaped) {
            if (endiannessOverride == null && ['<', '>'].includes(char)) {
                endiannessOverride = char;
                continue;
            }
            escaped = false;
            if (char === '?') {
                inputStack.shift();
                continue;
            }
            if (char in FORMAT_TYPE_LEN_DICT) {
                let value = JSBI.BigInt(0);
                for (let byte = FORMAT_TYPE_LEN_DICT[char] - 1; byte >= 0; byte--) {
                    let b = byte;
                    if (endiannessOverride === '<') {
                        // Use little-endian
                        b = FORMAT_TYPE_LEN_DICT[char] - 1 - byte;
                    }
                    let v = JSBI.BigInt(inputStack.shift()!);
                    v = JSBI.leftShift(v, JSBI.BigInt(b * 8));
                    value = JSBI.bitwiseOr(value, v);
                }
                endiannessOverride = null;
                result.push(value);
            } else if (char === 's' || char === 'x' || char === 'z') {
                let length = char === 'z' ? inputStack.shift()! : (inputStack.shift()! << 8) | inputStack.shift()!;
                let newInputStack = inputStack.splice(length);
                let buffer = new Uint8Array(inputStack);
                inputStack = newInputStack;
                if (char === 's') {
                    result.push(buffer);
                    // result.push(value.substring(0, value.length - 1));
                } else {
                    result.push(buffer);
                }
            } else if (char === '*') {
                let buffer = new Uint8Array(inputStack.splice(0));
                result.push(buffer);
            } else if (char === '#') {
                let value = new Uint8Array(inputStack.splice(0));
                result.push(value);
            } else if (char === 'B') {
                let v = inputStack.shift()!;
                result.push(BCD2int(v));
            } else if (char === 'W') {
                let v = (inputStack.shift()! << 8) | inputStack.shift()!;
                result.push(BCD2int(v));
            } else {
                throw new Error(`Unrecognized format char ${char}`);
            }
            continue;
        }
        if (char === '%') {
            assert(half === null);
            escaped = true;
            continue;
        }
        if (char === ' ') {
            continue;
        }
        if (half === null) {
            half = char;
        } else {
            let inputValue = inputStack.shift();
            let formatValue = Number.parseInt(half + char, 16);
            if (formatValue != inputValue) {
                let i = initialLength - inputStack.length - 1;
                throw new Error(`Format and input mismatch at ${i}: expected ${formatValue}, got ${inputValue} (format ${format})`);
            }
            half = null;
        }
    }
    assert(inputStack.length === 0, `${inputStack.length} Bytes remaining to parse`);
    return result;
}

export function BCD2int(bcd: number /* max 32 bits */) {
    let value = 0;
    let nibble = 0;
    while (bcd !== 0) {
        let nibbleValue = bcd & 0xf;
        bcd = bcd >>> 4;
        value += nibbleValue * Math.pow(10, nibble);
        nibble += 1;
    }
    return value;
}

export function int2BCD(value: number, length = 1) {
    if (length > 4) {
        throw new Error(`Unsupported length. Max allowed is 4`);
    }
    if (value > Math.pow(10, length * 2) - 1) {
        throw new Error(`Value ${value} cannot fit in ${length} bytes in BCD`);
    }
    let bcd = 0;
    let nibble = 0;
    let nibbleValue;
    while (value) {
        [value, nibbleValue] = [Math.floor(value / 10), value % 10];
        bcd |= nibbleValue << (4 * nibble);
        nibble += 1;
    }
    return bcd;
}
