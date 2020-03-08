import { usb } from 'webusb';
import { NetMD } from './netmd';
import { ConsoleLogger } from './logger';

describe('Simple Queries', function() {
    let device: USBDevice;
    let netmd: NetMD;

    beforeEach(async function() {
        // const testLogger = bunyan.createLogger({ name: 'test', level: 'debug' });
        let testLogger = new ConsoleLogger(0);

        device = await usb.requestDevice({ filters: [{ vendorId: 0x054c, productId: 0x00c8 }] });
        netmd = new NetMD(device, 0, testLogger);
        await netmd.init();
    });

    afterEach(async function() {
        await netmd.finalize();
    });

    test('Just init and finalize', async function() {
        let command = new Uint8Array([0x00, 0x18, 0x06, 0x01, 0x10, 0x10, 0x00, 0xff, 0x00, 0x00, 0x01, 0x00, 0x0b]);
        await netmd.sendCommand(command.buffer);
        await netmd.readReply();
    });
});
