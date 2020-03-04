import { inspect } from 'util';
import { sleep, concatArrayBuffers } from './utils';
import Logger from 'bunyan';

const BULK_WRITE_ENDPOINT = 0x02;
const BULK_READ_ENDPOINT = 0x81;

export class NetMD {
    static readReplyRetryIntervalInMsec = 100;

    constructor(private device: USBDevice, private iface: number = 0, private logger?: Logger) {
        this.logger = logger?.child({ class: 'NetMD' });
    }

    async init() {
        this.logger?.debug('Init');

        if (!this.device.opened) {
            this.logger?.debug('Opening device');
            await this.device.open();
        }

        await this.device.selectConfiguration(1);
        await this.device.claimInterface(this.iface);

        const len = await this.getReplyLength();
        if (len > 0) {
            await this.readReply();
        }
    }

    async finalize() {
        this.logger?.debug('Finalize');
        try {
            await this.device.reset();
            await this.device.releaseInterface(this.iface);
            await this.device.close();
        } catch (err) {
            this.logger?.error({ err });
            // log the error. nothing to do
        }
    }

    async getReplyLength() {
        let result = await this.device.controlTransferIn(
            {
                requestType: 'vendor',
                recipient: 'interface',
                request: 0x01,
                value: 0,
                index: 0,
            },
            4
        );
        const len = result.data?.getUint8(2) ?? 0;
        this.logger?.debug({ action: 'getReplyLength', result: inspect(result), len });
        return len;
    }

    public async sendCommand(command: BufferSource) {
        this.logger?.debug({ action: 'sendCommand', command: inspect(command) });
        await this.device.controlTransferOut(
            {
                requestType: 'vendor',
                recipient: 'interface',
                request: 0x80,
                value: 0,
                index: 0,
            },
            command
        );
    }

    public async readReply() {
        let len = 0;
        while (len === 0) {
            len = await this.getReplyLength();
            await sleep(NetMD.readReplyRetryIntervalInMsec);
        }

        let result = await this.device.controlTransferIn(
            {
                requestType: 'vendor',
                recipient: 'interface',
                request: 0x81,
                value: 0,
                index: 0,
            },
            len
        );
        this.logger?.debug({ action: 'readReply', result: inspect(result) });
        return result;
    }

    public async readBulk(length: number) {
        let result = await this.readBulkToArray(length);
        return new Uint8Array(result);
    }

    public async readBulkToArray(length: number, chunksize: number = 0x10000) {
        let done = 0;
        let buffer = new ArrayBuffer(0);
        while (done < length) {
            let res = await this.device.transferIn(this.iface, Math.min(length - done, length));
            if (!res.data) {
                throw new Error('expected data');
            }
            done += res.data.byteLength; // TODO: handle this case
            buffer = concatArrayBuffers(buffer, res.data.buffer);
        }
        return buffer;
    }

    public async writeBulk(data: BufferSource) {
        return await this.device.transferOut(BULK_WRITE_ENDPOINT, data);
    }
}
