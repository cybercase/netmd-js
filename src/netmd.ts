import { inspect } from 'util';
import { sleep, concatArrayBuffers } from './utils';
import { Logger } from './logger';

const BULK_WRITE_ENDPOINT = 0x02;
const BULK_READ_ENDPOINT = 0x81;

export const DevicesIds = [
    { vendorId: 0x04dd, deviceId: 0x7202, name: 'Sharp IM-MT899H' },
    { vendorId: 0x04dd, deviceId: 0x9013, name: 'Sharp IM-DR400' },
    { vendorId: 0x04dd, deviceId: 0x9014, name: 'Sharp IM-DR80' },
    { vendorId: 0x054c, deviceId: 0x0034, name: 'Sony PCLK-XX' },
    { vendorId: 0x054c, deviceId: 0x0036, name: 'Sony' },
    { vendorId: 0x054c, deviceId: 0x0075, name: 'Sony MZ-N1' },
    { vendorId: 0x054c, deviceId: 0x007c, name: 'Sony' },
    { vendorId: 0x054c, deviceId: 0x0080, name: 'Sony LAM-1' },
    { vendorId: 0x054c, deviceId: 0x0081, name: 'Sony MDS-JB980' },
    { vendorId: 0x054c, deviceId: 0x0084, name: 'Sony MZ-N505' },
    { vendorId: 0x054c, deviceId: 0x0085, name: 'Sony MZ-S1' },
    { vendorId: 0x054c, deviceId: 0x0086, name: 'Sony MZ-N707' },
    { vendorId: 0x054c, deviceId: 0x008e, name: 'Sony CMT-C7NT' },
    { vendorId: 0x054c, deviceId: 0x0097, name: 'Sony PCGA-MDN1' },
    { vendorId: 0x054c, deviceId: 0x00ad, name: 'Sony CMT-L7HD' },
    { vendorId: 0x054c, deviceId: 0x00c6, name: 'Sony MZ-N10' },
    { vendorId: 0x054c, deviceId: 0x00c7, name: 'Sony MZ-N910' },
    { vendorId: 0x054c, deviceId: 0x00c8, name: 'Sony MZ-N710/NF810' },
    { vendorId: 0x054c, deviceId: 0x00c9, name: 'Sony MZ-N510/N610' },
    { vendorId: 0x054c, deviceId: 0x00ca, name: 'Sony MZ-NE410/NF520D' },
    { vendorId: 0x054c, deviceId: 0x00eb, name: 'Sony MZ-NE810/NE910' },
    { vendorId: 0x054c, deviceId: 0x0101, name: 'Sony LAM-10' },
    { vendorId: 0x054c, deviceId: 0x0113, name: 'Aiwa AM-NX1' },
    { vendorId: 0x054c, deviceId: 0x014c, name: 'Aiwa AM-NX9' },
    { vendorId: 0x054c, deviceId: 0x017e, name: 'Sony MZ-NH1' },
    { vendorId: 0x054c, deviceId: 0x0180, name: 'Sony MZ-NH3D' },
    { vendorId: 0x054c, deviceId: 0x0182, name: 'Sony MZ-NH900' },
    { vendorId: 0x054c, deviceId: 0x0184, name: 'Sony MZ-NH700/NH800' },
    { vendorId: 0x054c, deviceId: 0x0186, name: 'Sony MZ-NH600/NH600D' },
    { vendorId: 0x054c, deviceId: 0x0188, name: 'Sony MZ-N920' },
    { vendorId: 0x054c, deviceId: 0x018a, name: 'Sony LAM-3' },
    { vendorId: 0x054c, deviceId: 0x01e9, name: 'Sony MZ-DH10P' },
    { vendorId: 0x054c, deviceId: 0x0219, name: 'Sony MZ-RH10' },
    { vendorId: 0x054c, deviceId: 0x021b, name: 'Sony MZ-RH710/MZ-RH910' },
    { vendorId: 0x054c, deviceId: 0x021d, name: 'Sony CMT-AH10' },
    { vendorId: 0x054c, deviceId: 0x022c, name: 'Sony CMT-AH10' },
    { vendorId: 0x054c, deviceId: 0x023c, name: 'Sony DS-HMD1' },
    { vendorId: 0x054c, deviceId: 0x0286, name: 'Sony MZ-RH1' },
];

export class NetMD {
    static readReplyRetryIntervalInMsec = 10;

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

    getDeviceName() {
        let { vendorId, productId } = this.device;
        let deviceId = DevicesIds.find(device => device.deviceId === productId && device.vendorId === vendorId);
        return deviceId?.name ?? 'Unknown Device';
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
        let len = await this.getReplyLength();
        let i = 0;
        while (len === 0) {
            await sleep(NetMD.readReplyRetryIntervalInMsec * Math.pow(2, ~~(i / 10))); // Double wait time every 10 attempts
            len = await this.getReplyLength();
            i++;
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
