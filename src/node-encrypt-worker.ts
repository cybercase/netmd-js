import { getAsyncPacketIterator } from './encrypt-generator';
import { Worker, isMainThread, parentPort } from 'worker_threads';

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
    }: {
        data: ArrayBuffer;
        frameSize: number;
        kek: Uint8Array;
    }): AsyncIterableIterator<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array }> {
        const w = worker;

        const initWorker = () => {
            w.postMessage(
                {
                    action: 'init',
                    data,
                    frameSize,
                    kek,
                },
                [data]
            );
        };

        const askNextChunk = () => {
            w.postMessage({ action: 'getChunk' });
        };

        let resolver: (data: any) => void;
        w.on('message', msg => {
            resolver(msg);
        });

        let encryptedBytes = 0;
        let totalBytes = data.byteLength;
        let chunks: Promise<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array } | null>[] = [];
        const queueNextChunk = () => {
            let chunkPromise = new Promise<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array } | null>(resolve => {
                resolver = data => {
                    if (data !== null) {
                        encryptedBytes += data.byteLength;
                        progressCallback && progressCallback({ totalBytes, encryptedBytes });
                        queueNextChunk();
                    }
                    resolve(data);
                };
            });
            chunks.push(chunkPromise);
            askNextChunk();
        };

        initWorker();
        queueNextChunk();

        let i = 0;
        while (1) {
            let r = await chunks[i];
            delete chunks[i];
            if (r === null) {
                break;
            }
            yield r;
            i++;
        }
    };
}

if (isMainThread) {
    // Nothing to do
} else {
    let iterator: AsyncIterableIterator<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array }>;
    parentPort!.on('message', async msg => {
        const { action, ...others } = msg;
        if (action === 'init') {
            const { data, frameSize, kek } = others;
            iterator = getAsyncPacketIterator({ data, frameSize, kek });
        } else if (action === 'getChunk') {
            let { value, done } = await iterator.next();
            if (done) {
                parentPort!.postMessage(null);
                process.exit(0);
            } else {
                let { key, iv, data }: { key: Uint8Array; iv: Uint8Array; data: Uint8Array } = value;
                parentPort!.postMessage({ key, iv, data }, [data.buffer]);
            }
        }
    });
}
