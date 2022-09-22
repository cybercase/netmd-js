import Crypto from '@originjs/crypto-js-wasm';
import { concatUint8Arrays, wordArrayToByteArray } from './utils';

export async function* getAsyncPacketIterator({
    data,
    frameSize,
    kek,
    chunkSize,
}: {
    data: ArrayBuffer;
    frameSize: number;
    kek: Uint8Array;
    chunkSize: number;
}): AsyncIterableIterator<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array }> {
    let iv = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    let ivWA = Crypto.lib.WordArray.create(iv) as any;

    const kekWA = Crypto.lib.WordArray.create(kek) as any;
    const rawKeyWA = Crypto.lib.WordArray.random(8);
    const keyDec = Crypto.DES.decrypt(
        {
            ciphertext: rawKeyWA,
        } as any,
        kekWA,
        { mode: Crypto.mode.ECB, padding: Crypto.pad.Pkcs7 }
    );
    (keyDec as any).sigBytes = 8;
    const key = wordArrayToByteArray(keyDec);

    const defaultChunkSize = chunkSize ? chunkSize : 0x00100000;
    let packetCount = 0;
    let currentChunkSize = 0;

    let uint8DataArray = new Uint8Array(data);

    if (uint8DataArray.length % frameSize !== 0) {
        // Pad to frame size if needed
        let padding = frameSize - (uint8DataArray.length % frameSize);
        uint8DataArray = concatUint8Arrays(uint8DataArray, new Uint8Array(Array(padding).fill(0)));
    }

    let offset = 0;
    while (offset < uint8DataArray.length) {
        if (packetCount > 0) {
            currentChunkSize = defaultChunkSize;
        } else {
            currentChunkSize = defaultChunkSize - 24;
        }

        currentChunkSize = Math.min(currentChunkSize, uint8DataArray.length - offset);

        const dataChunk = uint8DataArray.subarray(offset, offset + currentChunkSize);
        const dataChunkWA = Crypto.lib.WordArray.create(dataChunk) as any;

        let encryptedChunk = Crypto.DES.encrypt(dataChunkWA, rawKeyWA as any, {
            mode: Crypto.mode.CBC,
            iv: ivWA,
        });

        let encryptedDataChunk = wordArrayToByteArray(encryptedChunk.ciphertext);
        encryptedDataChunk = encryptedDataChunk.subarray(0, currentChunkSize); //encryptedDataChunk.length - 8

        // Prepare Next iv before yielding the encryptedDataChunk (might be neutered after yield)
        let nextIvWA = Crypto.lib.WordArray.create(encryptedDataChunk.subarray(encryptedDataChunk.length - 8, encryptedDataChunk.length));
        let nextiv = wordArrayToByteArray(ivWA);

        yield { key, iv, data: encryptedDataChunk };

        ivWA = nextIvWA;
        iv = nextiv;

        offset = offset + currentChunkSize;
        packetCount += 1;
    }
}
