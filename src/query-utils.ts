import { assert, assertUint8Array } from './utils';
import JSBI from 'jsbi';

// prettier-ignore
const FORMAT_TYPE_LEN_DICT: { [k: string]: number } = {
    'b': 1, // byte
    'w': 2, // word
    'd': 4, // doubleword
    'q': 8, // quadword
};

export function formatQuery(format: string, ...args: unknown[]): ArrayBuffer {
    let result = [];
    let half: null | string = null;
    let argStack = Array.from(args);

    let escaped = false;
    for (let char of format) {
        if (escaped) {
            escaped = false;
            let value = argStack.shift();
            if (char in FORMAT_TYPE_LEN_DICT) {
                let numberValue = JSBI.BigInt(value as JSBI | number);
                for (let byte = FORMAT_TYPE_LEN_DICT[char] - 1; byte >= 0; byte--) {
                    let v = JSBI.signedRightShift(numberValue, JSBI.BigInt(byte * 8));
                    v = JSBI.bitwiseAnd(v, JSBI.BigInt(0xff));
                    result.push(JSBI.toNumber(v));
                }
            } else if (char === 'x' || char === 's') {
                let uint8ArrayValue = assertUint8Array(value);
                let bufferLength = uint8ArrayValue.byteLength;
                if (char === 's') {
                    bufferLength += 1;
                }
                result.push((bufferLength >> 8) & 0xff);
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

export function scanQuery(query: ArrayBuffer | number[], format: string) {
    let result: unknown[] = [];
    let inputStack: number[];
    if (query instanceof ArrayBuffer) {
        inputStack = Array.from(new Uint8Array(query));
    } else {
        inputStack = query;
    }
    let initialLength = inputStack.length;
    let half: string | null = null;
    let escaped = false;

    for (let char of format) {
        if (escaped) {
            escaped = false;
            if (char === '?') {
                inputStack.shift();
                continue;
            }
            if (char in FORMAT_TYPE_LEN_DICT) {
                let value = JSBI.BigInt(0);
                for (let byte = FORMAT_TYPE_LEN_DICT[char] - 1; byte >= 0; byte--) {
                    let v = JSBI.BigInt(inputStack.shift()!);
                    v = JSBI.leftShift(v, JSBI.BigInt(byte * 8));
                    value = JSBI.bitwiseOr(value, v);
                }
                result.push(value);
            } else if (char === 's' || char === 'x') {
                let length = (inputStack.shift()! << 8) | inputStack.shift()!;
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
                throw new Error(`Format and input mismatch at ${i}: expected ${formatValue}, got ${inputValue}`);
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
