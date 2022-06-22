/* A few unit test I've used to quickly check my implementation */

import JSBI from 'jsbi';
import { scanQuery, formatQuery, BCD2int, int2BCD } from './query-utils';
import { arrayBuffersAreEqual, assert, encodeToSJIS, assertUint8Array } from './utils';

describe('formatQuery', function() {
    test('format const', function() {
        let query = formatQuery('00 00 00 01');
        let result = new Uint8Array([0x00, 0x00, 0x00, 0x01]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format string', function() {
        let query = formatQuery('00 00 00 %x', encodeToSJIS('ciao'));
        let result = new Uint8Array([
            0x00,
            0x00, // Header
            0x00,
            0x00, // lenght (2 bytes)
            0x04,
            0x63,
            0x69,
            0x61,
            0x6f, // data
        ]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format uint8array', function() {
        let query = formatQuery('00 00 00 %*', new Uint8Array([0xff, 0x00]));
        let result = new Uint8Array([0x00, 0x00, 0x00, 0xff, 0x00]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format raw string', function() {
        let query = formatQuery('00 00 00 %*', encodeToSJIS('abc'));
        let result = new Uint8Array([0x00, 0x00, 0x00, 0x61, 0x62, 0x63]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format null terminated string', function() {
        let query = formatQuery('00 00 00 %s', encodeToSJIS('ciao'));
        let result = new Uint8Array([
            0x00,
            0x00, // Header
            0x00,
            0x00, // lenght (2 bytes)
            0x05,
            0x63,
            0x69,
            0x61,
            0x6f,
            0x00, // data
        ]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format byte', function() {
        let query = formatQuery('00 00 00 %b', 0xff);
        let result = new Uint8Array([0x00, 0x00, 0x00, 0xff]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format word', function() {
        let query = formatQuery('00 00 00 %w', 0xff01);
        let result = new Uint8Array([0x00, 0x00, 0x00, 0xff, 0x01]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format double word', function() {
        let query = formatQuery('00 00 00 %d', 0xff019922);
        let result = new Uint8Array([0x00, 0x00, 0x00, 0xff, 0x01, 0x99, 0x22]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format double word little endian', function() {
        let query = formatQuery('00 00 00 %<d', 0xff019922);
        let result = new Uint8Array([0x00, 0x00, 0x00, 0x22, 0x99, 0x01, 0xff]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format quad word', function() {
        let query = formatQuery('00 00 00 %q', JSBI.BigInt('0xff019922229901ff'));
        let result = new Uint8Array([0x00, 0x00, 0x00, 0xff, 0x01, 0x99, 0x22, 0x22, 0x99, 0x01, 0xff]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format 1-byte BCD', function() {
        let query = formatQuery('00 00 00 %B', 24);
        let result = new Uint8Array([0x00, 0x00, 0x00, 0x24]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });

    test('format 2-byte BCD', function() {
        let query = formatQuery('00 00 00 %W', 24);
        let result = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x24]);
        expect(arrayBuffersAreEqual(query, result.buffer)).toBeTruthy();
    });
});

describe('scanQuery', function() {
    test('parse const', function() {
        let query = new Uint8Array([0x00, 0x00, 0x00, 0x01]);
        let format = '00 00 00 01';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(0);
    });

    test('parse wildcard', function() {
        let query = new Uint8Array([0x00, 0x00, 0x00, 0x01]);
        let format = '00 00 %? 01';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(0);
    });

    test('parse remainings', function() {
        let query = new Uint8Array([0x00, 0x00, 0x00, 0x01]);
        let format = '00 00 %*';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(1);
        let remaining = assertUint8Array(result.pop());
        expect(remaining).toEqual(new Uint8Array([0x00, 0x01]));
    });

    test('parse string', function() {
        let query = new Uint8Array([
            0x00,
            0x00, // Header
            0x00, // lenght (2 bytes)
            0x04,
            0x63,
            0x69,
            0x61,
            0x6f, // data
        ]);
        let format = '00 00 %x';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(1);
        let value = Buffer.from(assertUint8Array(result.pop())).toString();
        expect(value).toEqual('ciao');
    });

    test('parse null terminated string', function() {
        let query = new Uint8Array([
            0x00,
            0x00, // Header
            0x00, // lenght (2 bytes)
            0x05,
            0x63,
            0x69,
            0x61,
            0x6f, // data
            0x00, // terminator
        ]);
        let format = '00 00 %s';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(1);
        let value = Buffer.from(assertUint8Array(result.pop())).toString();
        expect(value).toEqual('ciao\0');
    });

    test('parse byte', function() {
        let query = new Uint8Array([0x00, 0x00, 0xff]);
        let format = '00 00 %b';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(1);
        let jsbiValue = result.pop();
        assert(jsbiValue instanceof JSBI);
        expect(JSBI.toNumber(jsbiValue as JSBI)).toEqual(0xff);
    });

    test('parse word', function() {
        let query = new Uint8Array([0x00, 0x00, 0xff, 0x01]);
        let format = '00 00 %w';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(1);
        let jsbiValue = result.pop();
        assert(jsbiValue instanceof JSBI);
        expect(JSBI.toNumber(jsbiValue as JSBI)).toEqual(0xff01);
    });

    test('parse double word', function() {
        let query = new Uint8Array([0x00, 0x00, 0xff, 0x01, 0xaa, 0x10]);
        let format = '00 00 %d';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(1);
        let jsbiValue = result.pop();
        assert(jsbiValue instanceof JSBI);
        expect(JSBI.toNumber(jsbiValue as JSBI)).toEqual(0xff01aa10);
    });

    test('parse quad word', function() {
        let query = new Uint8Array([0x00, 0x00, 0xff, 0x01, 0xaa, 0x10, 0x10, 0xaa, 0x01, 0xff]);
        let format = '00 00 %q';
        let result = scanQuery(query, format);
        expect(result).toHaveLength(1);
        let jsbiValue = result.pop();
        assert(jsbiValue instanceof JSBI);
        expect(JSBI.toNumber(jsbiValue as JSBI)).toEqual(0xff01aa1010aa01ff);
    });
});

describe('BCD conversion', function() {
    test('1 byte conversion', function() {
        let bcd = int2BCD(99);
        let int = BCD2int(bcd);
        expect(int).toEqual(99);
    });

    test('2 byte conversion', function() {
        let bcd = int2BCD(9999, 2);
        let int = BCD2int(bcd);
        expect(int).toEqual(9999);
    });

    test('3 byte conversion', function() {
        let bcd = int2BCD(999999, 3);
        let int = BCD2int(bcd);
        expect(int).toEqual(999999);
    });

    test('4 byte bit conversion', function() {
        let bcd = int2BCD(99999999, 4);
        let int = BCD2int(bcd);
        expect(int).toEqual(99999999);
    });
});
