import { assert, concatUint8Arrays, decryptDataFromFactoryTransfer, encryptDataForFactoryTransfer } from '../utils';
import { NetMDFactoryInterface, DisplayMode, MemoryOpenType, MemoryType } from './netmd-factory-interface';
import { formatQuery, scanQuery } from '../query-utils';
import JSBI from 'jsbi';

export async function display(factoryInterface: NetMDFactoryInterface, text: string | Uint8Array, blink: boolean = false) {
    await factoryInterface.setDisplayMode(DisplayMode.OVERRIDE);
    await factoryInterface.setDisplayOverride(text, blink);
}

export async function cleanRead(
    factoryInterface: NetMDFactoryInterface,
    address: number,
    length: number,
    type: MemoryType,
    encrypted: boolean = false,
    autoDecrypt: boolean = true
) {
    await factoryInterface.changeMemoryState(address, length, type, MemoryOpenType.READ, encrypted);
    let resp = await factoryInterface.read(address, length, type);
    await factoryInterface.changeMemoryState(address, length, type, MemoryOpenType.CLOSE, encrypted);
    if (encrypted && autoDecrypt) {
        resp = decryptDataFromFactoryTransfer(resp);
    }
    return resp;
}

export async function cleanWrite(
    factoryInterface: NetMDFactoryInterface,
    address: number,
    data: Uint8Array,
    type: MemoryType,
    encrypted: boolean = false,
    autoEncrypt: boolean = true
) {
    if (encrypted && autoEncrypt) {
        data = encryptDataForFactoryTransfer(data);
    }
    await factoryInterface.changeMemoryState(address, data.length, type, MemoryOpenType.WRITE, encrypted);
    await factoryInterface.write(address, data, type);
    await factoryInterface.changeMemoryState(address, data.length, type, MemoryOpenType.CLOSE, encrypted);
}

export async function writeOfAnyLength(
    factoryInterface: NetMDFactoryInterface,
    address: number,
    data: Uint8Array,
    type: MemoryType,
    encrypted: boolean = false
) {
    const SIZE = 0x10;
    let arr = [...data];
    let i = 0;
    do {
        await cleanWrite(factoryInterface, address + i++ * SIZE, new Uint8Array(arr.splice(0, SIZE)), type, encrypted);
    } while (arr.length > 0);
}

export async function readPatch(factoryInterface: NetMDFactoryInterface, patchNumber: number) {
    const base = 0x03802000 + patchNumber * 0x10;

    const address = JSBI.toNumber(scanQuery(await cleanRead(factoryInterface, base + 4, 4, MemoryType.MAPPED), "%<d")[0] as any);
    const data = await cleanRead(factoryInterface, base + 8, 4, MemoryType.MAPPED);

    return { address, data };
}

export async function patch(factoryInterface: NetMDFactoryInterface, address: number, value: Uint8Array, patchNumber: number, totalPatches: number) {
    // Original method written by Sir68k.
    assert(value.length === 4);

    const base = 0x03802000 + patchNumber * 0x10;
    const control = 0x03802000 + totalPatches * 0x10;

    // Write 5, 12 to main control
    await cleanWrite(factoryInterface, control, new Uint8Array([5]), MemoryType.MAPPED);
    await cleanWrite(factoryInterface, control, new Uint8Array([12]), MemoryType.MAPPED);

    // AND 0xFE with patch control
    let patchControl = await cleanRead(factoryInterface, base, 4, MemoryType.MAPPED);
    patchControl[0] = (patchControl[0] & 0xfe) >>> 0;
    await cleanWrite(factoryInterface, base, patchControl, MemoryType.MAPPED);

    // AND 0xFD with patch control
    patchControl = await cleanRead(factoryInterface, base, 4, MemoryType.MAPPED);
    patchControl[0] = (patchControl[0] & 0xfd) >>> 0;
    await cleanWrite(factoryInterface, base, patchControl, MemoryType.MAPPED);

    // Write patch ADDRESS
    await cleanWrite(factoryInterface, base + 4, new Uint8Array(formatQuery('%<d', address)), MemoryType.MAPPED);

    // Write patch VALUE
    await cleanWrite(factoryInterface, base + 8, value, MemoryType.MAPPED);

    // OR 1 with patch control
    patchControl = await cleanRead(factoryInterface, base, 4, MemoryType.MAPPED);
    patchControl[0] = (patchControl[0] | 1) >>> 0;
    await cleanWrite(factoryInterface, base, patchControl, MemoryType.MAPPED);

    // write 5, 9 to main control
    await cleanWrite(factoryInterface, control, new Uint8Array([5]), MemoryType.MAPPED);
    await cleanWrite(factoryInterface, control, new Uint8Array([9]), MemoryType.MAPPED);
}

export async function unpatch(factoryInterface: NetMDFactoryInterface, patchNumber: number, totalPatches: number) {
    const base = 0x03802000 + patchNumber * 0x10;
    const control = 0x03802000 + totalPatches * 0x10;

    // Write 5, 12 to main control
    await cleanWrite(factoryInterface, control, new Uint8Array([5]), MemoryType.MAPPED);
    await cleanWrite(factoryInterface, control, new Uint8Array([12]), MemoryType.MAPPED);

    let patchControl = await cleanRead(factoryInterface, base, 4, MemoryType.MAPPED);
    patchControl[0] = (patchControl[0] & 0xfe) >>> 0;
    await cleanWrite(factoryInterface, base, patchControl, MemoryType.MAPPED);

    // write 5, 9 to main control
    await cleanWrite(factoryInterface, control, new Uint8Array([5]), MemoryType.MAPPED);
    await cleanWrite(factoryInterface, control, new Uint8Array([9]), MemoryType.MAPPED);
}

export async function readUTOCSector(factoryInterface: NetMDFactoryInterface, sector: number): Promise<Uint8Array> {
    const SIZE = 0x10;
    let parts: Uint8Array[] = [];
    for (let i = 0; i < 147; i++) {
        // 147 * 16 = 2352 - sector length
        parts.push(await factoryInterface.readMetadataPeripheral(sector, i * SIZE, SIZE));
    }
    return concatUint8Arrays(...parts);
}

export async function writeUTOCSector(factoryInterface: NetMDFactoryInterface, sector: number, data: Uint8Array) {
    const SIZE = 0x10;
    assert(data.length === 2352, 'The data provided is not a valid TOC Sector');
    let arr = Array.from(data);
    let i = 0;
    while (arr.length) {
        await factoryInterface.writeMetadataPeripheral(sector, SIZE * i++, new Uint8Array(arr.splice(0, SIZE)));
    }
}

export async function getDescriptiveDeviceCode(input: (NetMDFactoryInterface | { chipType: number, version: number })) {
    let chipType, version;
    if((input as any).chipType !== undefined && (input as any).chipType !== undefined){
        ({version, chipType} = (input as any));
    } else {
        ({version, chipType} = await (input as NetMDFactoryInterface).getDeviceCode());
    }
    let code = '';
    switch (chipType) {
        case 0x20:
            code = 'R';
            break;
        case 0x21:
            code = 'S';
            break;
        case 0x24:
            code = 'Hi';
            break;
        default:
            code = `${chipType}?`;
            break;
    }
    const [maj, min] = version.toString().split('');
    code += `${maj}.${min}00`;
    return code;
}
