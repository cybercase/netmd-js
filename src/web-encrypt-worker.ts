import { getAsyncPacketIterator } from './encrypt-generator';
import Crypto from '@originjs/crypto-js-wasm';

// This generator uses a worker thread to encrypt the nextChunk
// while yielding the current one.
export function makeGetAsyncPacketIteratorOnWorkerThread(
    worker: Worker,
    progressCallback?: (progress: { totalBytes: number; encryptedBytes: number }) => void
) {
    return async function* getAsyncPacketIteratorOnWorkerThread({
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
        const w = worker;
        const initWorker = () =>
            new Promise(res => {
                w.postMessage(
                    {
                        action: 'init',
                        data,
                        frameSize,
                        kek,
                        chunkSize,
                    },
                    [data]
                );
                w.onmessage = res;
            });

        const askNextChunk = () => {
            w.postMessage({ action: 'getChunk' });
        };

        let resolver: (data: any) => void;

        let encryptedBytes = 0;
        let totalBytes = data.byteLength;
        let chunks: Promise<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array } | null>[] = [];
        const queueNextChunk = () => {
            let chunkPromise = new Promise<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array } | null>(resolve => {
                resolver = data => {
                    if (data !== null) {
                        encryptedBytes += data.data.byteLength;
                        progressCallback && progressCallback({ totalBytes, encryptedBytes });
                        queueNextChunk();
                    }
                    resolve(data);
                };
            });
            chunks.push(chunkPromise);
            askNextChunk();
        };

        await initWorker();
        w.onmessage = (ev: MessageEvent) => {
            resolver(ev.data);
        };

        queueNextChunk();

        let i = 0;
        while (1) {
            let r = await chunks[i];
            if (r === null) {
                break;
            }
            yield r;
            delete chunks[i];
            i++;
        }
    };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    // Worker
    let iterator: AsyncIterableIterator<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array }>;
    onmessage = async (ev: MessageEvent) => {
        const { action, ...others } = ev.data;
        if (action === 'init') {
            const { data, frameSize, kek, chunkSize } = others;
            await Crypto.DES.loadWasm();
            iterator = getAsyncPacketIterator({ data, frameSize, kek, chunkSize });
            postMessage({ init: true });
        } else if (action === 'getChunk') {
            let { value, done } = await iterator.next();
            if (done) {
                postMessage(null);
                self.close();
            } else {
                let { key, iv, data }: { key: Uint8Array; iv: Uint8Array; data: Uint8Array } = value;
                postMessage({ key, iv, data }, [data.buffer]);
            }
        }
    };
} else {
    // Main
}
