import { NetMDError } from "./netmd-shared-objects";

export interface EKB {
    getRootKey(): Uint8Array;
    getEKBID(): number;
    getEKBDataForLeafId(): [Uint8Array[], number, Uint8Array];
}

type EKBConstructor = (new () => EKB) & { doesEKBMatchDevice(leafID: Uint8Array, vid: number, pid: number): boolean };

export class EKBOpenSource implements EKB {
    static doesEKBMatchDevice() {
        return true;
    }

    getRootKey() {
        // prettier-ignore
        return new Uint8Array([
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
            0x0f, 0xed, 0xcb, 0xa9, 0x87, 0x65, 0x43, 0x21
        ])
    }

    getEKBID() {
        return 0x26422642;
    }

    getEKBDataForLeafId(): [Uint8Array[], number, Uint8Array] {
        // prettier-ignore
        return [
            [
                new Uint8Array([0x25, 0x45, 0x06, 0x4d, 0xea, 0xca, 0x14, 0xf9, 0x96, 0xbd, 0xc8, 0xa4, 0x06, 0xc2, 0x2b, 0x81]),
                new Uint8Array([0xfb, 0x60, 0xbd, 0xdd, 0x0d, 0xbc, 0xab, 0x84, 0x8a, 0x00, 0x5e, 0x03, 0x19, 0x4d, 0x3e, 0xda]),
            ],
            9,
            new Uint8Array([
                0x8f, 0x2b, 0xc3, 0x52, 0xe8, 0x6c, 0x5e, 0xd3, 0x06, 0xdc, 0xae, 0x18,
                0xd2, 0xf3, 0x8c, 0x7f, 0x89, 0xb5, 0xe1, 0x85, 0x55, 0xa1, 0x05, 0xea
            ])
        ];
    }
}

// EKB generated by Sir68k
export class CorruptedDeckEKB implements EKB {
    static doesEKBMatchDevice(leafID: Uint8Array, vid: number, pid: number): boolean {
        // VID = Sony
        // PID = Decks (JB980 / JE780 / NT1 [unlikely to be damaged])
        return leafID.every(e => e === 0xFF) && vid == 0x054c && pid == 0x0081;
    }

    getRootKey() {
        // prettier-ignore
        return new Uint8Array([
            // 'WMDPWMDPMiniDisc'
            0x57, 0x4d, 0x44, 0x50, 0x57, 0x4d, 0x44, 0x50,
            0x4d, 0x69, 0x6e, 0x69, 0x44, 0x69, 0x73, 0x63
        ])
    }

    getEKBID() {
        return 0x13371337;
    }

    getEKBDataForLeafId(): [Uint8Array[], number, Uint8Array] {
        // prettier-ignore
        return [
            [
                new Uint8Array([0xb1, 0xd4, 0xaf, 0xfa, 0x80, 0xa0, 0xc9, 0x03, 0xc2, 0x58, 0x4b, 0x1b, 0x44, 0xaf, 0xc4, 0xa6]),
            ],
            9,

            new Uint8Array([
                0x6c, 0x2b, 0xc2, 0x8c, 0x45, 0x2b, 0x54, 0xf1, 0xc3, 0x59, 0x72, 0x3b,
                0xe3, 0x19, 0x1f, 0x55, 0x17, 0x25, 0x64, 0x0e, 0x65, 0x8c, 0x81, 0x0b
            ])
        ];
    }
}

const EKBHierarchy: EKBConstructor[] = [ CorruptedDeckEKB, EKBOpenSource ];

export function getEKBForDevice(leafID: Uint8Array, vid: number, pid: number): EKB {
    for(let ekb of EKBHierarchy){
        if(ekb.doesEKBMatchDevice(leafID, vid, pid)) return new ekb();
    }
    throw new NetMDError("Cannot find appropriate EKB for this device!");
}
