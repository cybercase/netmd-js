import { NetMD } from '../netmd';
import { Logger } from '../logger';
import { assert, concatArrayBuffers, concatUint8Arrays, encodeToSJIS, sleep } from '../utils';
import { NetMDNotImplemented, NetMDRejected, Status } from '../netmd-shared-objects';
import { formatQuery, scanQuery } from '../query-utils';
import JSBI from 'jsbi';

export enum MemoryType {
    MAPPED = 0x0,
    EEPROM_2 = 0x2,
    EEPROM_3 = 0x3,
}

export enum MemoryOpenType {
    CLOSE = 0x0,
    READ = 0x1,
    WRITE = 0x2,
    READ_WRITE = 0x3,
}

export enum DisplayMode {
    DEFAULT = 0x0,
    OVERRIDE = 0x1,
}

function calculateChecksum(data: Uint8Array, as16Bit: boolean) {
    let crc = 0;
    let newData: Uint8Array | Uint16Array = data;
    if (as16Bit) {
        newData = new Uint16Array(data.length / 2);
        for (let i = 0; i < newData.length; i++) {
            newData[i] = (data[2 * i + 1] << 8) | data[2 * i];
        }
    }
    let temp = newData.length;
    newData.forEach((e: any) => {
        temp = (temp & 0xffff0000) | e;

        crc ^= temp;
        for (let i = 0; i < 16; i++) {
            let ts = crc & 0x8000;
            crc <<= 1;
            if (ts) crc ^= 0x1021;
        }
    });
    crc = (crc & 0xffff) >>> 0;
    return crc;
}

export function calculateEEPROMChecksum(data: Uint8Array) {
    return calculateChecksum(data, true);
}

export class NetMDFactoryInterface {
    static interimResponseRetryIntervalInMs = 100;
    static maxInterimReadAttempts = 4;

    constructor(public netMd: NetMD, private logger?: Logger) {
        this.logger = logger?.child({ class: 'NetMDFactoryInterface' });
    }

    async sendQuery(query: ArrayBuffer, test = false, acceptInterim = false) {
        await this.sendCommand(query, test);
        return this.readReply(acceptInterim);
    }

    async sendCommand(query: ArrayBuffer, test = false) {
        let statusByte: ArrayBuffer;
        if (test) {
            statusByte = new Uint8Array([Status.specificInquiry]).buffer;
        } else {
            statusByte = new Uint8Array([Status.control]).buffer;
        }
        this.netMd.sendFactoryCommand(concatArrayBuffers(statusByte, query));
    }

    async readReply(acceptInterim = false) {
        let currentAttempt = 0;
        let data: DataView | undefined;
        while (currentAttempt < NetMDFactoryInterface.maxInterimReadAttempts) {
            ({ data } = await this.netMd.readFactoryReply());
            if (data === undefined) {
                throw new Error('unexpected undefined value in readReply');
            }

            let status = data.getUint8(0);
            if (status === Status.notImplemented) {
                throw new NetMDNotImplemented('Not implemented');
            } else if (status === Status.rejected) {
                throw new NetMDRejected(
                    `Rejected - ${[...new Uint8Array(data.buffer)].map(n => n.toString(16).padStart(2, '0')).join('')}`
                );
            } else if (status === Status.interim && !acceptInterim) {
                await sleep(NetMDFactoryInterface.interimResponseRetryIntervalInMs * (Math.pow(2, currentAttempt) - 1));
                currentAttempt += 1;
                continue; // Retry
            } else if ([Status.accepted, Status.implemented, Status.interim].indexOf(status) < -1) {
                throw new NetMDNotImplemented(`Unknown return status: ${status}`);
            } else {
                break; // Success!
            }
        }
        if (currentAttempt >= NetMDFactoryInterface.maxInterimReadAttempts) {
            throw new NetMDRejected('Max attempts read attempts for interim status reached');
        }
        return data!.buffer.slice(1);
    }

    public async auth() {
        await this.sendQuery(formatQuery('1801 ff0e 4e6574204d442057616c6b6d616e'));
    }

    public async changeMemoryState(address: number, length: number, type: MemoryType, state: MemoryOpenType, encrypted: boolean = false) {
        await this.sendQuery(formatQuery('1820 ff %b %<d %b %b %b', type, address, length, state, encrypted ? 0x1 : 0x0));
    }

    public async read(address: number, length: number, type: MemoryType) {
        if (type !== MemoryType.MAPPED && address + 8 > 0x400) throw new Error('SANITY CHECK');

        const reply = await this.sendQuery(formatQuery('1821 ff %b %<d %b', type, address, length));
        const res = scanQuery(reply, '1821 00 %? %?%?%?%? %? %?%? %*');
        const arr = [...(res[0] as Uint8Array)];
        arr.splice(arr.length - 2);
        return new Uint8Array(arr);
    }

    public async write(address: number, data: Uint8Array, type: MemoryType) {
        if (type !== MemoryType.MAPPED && address + 8 > 0x400) throw new Error('SANITY CHECK');
        const query = formatQuery('1822 ff %b %<d %b 0000 %* %<w', type, address, data.length, data, calculateChecksum(data, false));
        await this.sendQuery(query);
    }

    public async readMetadataPeripheral(sector: number, offset: number, length: number) {
        const query = formatQuery('1824 ff %<w %<w %b 00', sector, offset, length);
        const reply = await this.sendQuery(query);
        const res = scanQuery(reply, '1824 00 %?%?%?%? %z');
        return res[0] as Uint8Array;
    }

    public async writeMetadataPeripheral(sector: number, offset: number, data: Uint8Array) {
        const query = formatQuery('1825 ff %<w %<w %z', sector, offset, data);
        await this.sendQuery(query);
    }

    public async setDisplayMode(mode: DisplayMode) {
        await this.sendQuery(formatQuery('1851 ff %b', mode));
    }

    public async setDisplayOverride(text: string | Uint8Array, blink: boolean) {
        let fullArray;
        if (text instanceof Uint8Array) {
            assert(text.length < 10, 'The Uint8Array provided has to be at most 9 bytes long');
            fullArray = concatUint8Arrays(text, new Uint8Array(Array(10 - text.length).fill(0)));
        } else {
            assert(text.length < 9, 'The text provided has to be at most 8 characters long'); // 0-terminator is required
            let inJIS = encodeToSJIS(text);
            fullArray = concatUint8Arrays(inJIS, new Uint8Array(Array(10 - inJIS.length).fill(0)));
        }
        let query = formatQuery('1852 ff %b %b 00 %*', 0 /* Buffer index. Currently unknown. */, blink ? 0x1 : 0x0, fullArray);
        await this.sendQuery(query);
    }

    public async getDeviceVersion() {
        const query = formatQuery('1813 ff');
        const reply = await this.sendQuery(query);
        const result = scanQuery(reply, '1813 00 00 %B');

        return JSBI.toNumber(result[0] as JSBI);
    }

    public async getDeviceCode() {
        const query = formatQuery('1812 ff');
        const reply = await this.sendQuery(query);
        const result = scanQuery(reply, '1812 00 %b %b 00 %B');

        const chipType = JSBI.toNumber(result[0] as JSBI);
        const hwid = JSBI.toNumber(result[1] as JSBI);
        const version = result[2] as number;
        return { chipType, hwid, version };
    }

    public async getSwitchStatus() {
        const query = formatQuery('1853 ff');
        const reply = await this.sendQuery(query);
        const result = scanQuery(reply, '1853 ff %w %b %b %w');
        const [internalMicroswich, button, xy, unlabeled] = result;

        return [
            JSBI.toNumber(internalMicroswich as JSBI),
            JSBI.toNumber(button as JSBI),
            JSBI.toNumber(xy as JSBI),
            JSBI.toNumber(unlabeled as JSBI),
        ];
    }
}

export class HiMDFactoryInterface extends NetMDFactoryInterface {
    public async auth() {
        await this.sendQuery(formatQuery('1802 ff04 4d44574d'));
    }

    public async changeMemoryState(address: number, length: number, type: MemoryType, state: MemoryOpenType, encrypted: boolean = false) {
        await this.sendQuery(formatQuery('182b ff %b %<d %b %b', type, address, length, state, encrypted ? 0x1 : 0x0));
    }

    public async read(address: number, length: number, type: MemoryType) {
        const reply = await this.sendQuery(formatQuery('182c ff %b %<d', length, address));
        const res = scanQuery(reply, '182c 00 %? %?%?%?%? %? %?%? %*');
        const arr = [...(res[0] as Uint8Array)];
        arr.splice(arr.length - 2);
        return new Uint8Array(arr);
    }
}
