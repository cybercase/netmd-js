import { getAsyncPacketIterator } from './encrypt-generator';
import { Worker, isMainThread, parentPort } from 'worker_threads';

// This generator uses a worker thread to encrypt the nextChunk
// while yielding the current one.
export async function* getAsyncPacketIteratorOnWorkerThread({
    data,
    frameSize,
    kek,
}: {
    data: ArrayBuffer;
    frameSize: number;
    kek: Uint8Array;
}): AsyncIterableIterator<[Uint8Array, Uint8Array, Uint8Array]> {
    let w = new Worker(__filename);

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

    const makeNextChunkPromise = () => {
        return new Promise(resolve => {
            w.once('message', msg => {
                resolve(msg);
            });
        });
    };

    initWorker();

    let chunkPromise = makeNextChunkPromise();
    askNextChunk();
    let chunk = await chunkPromise;
    while (chunk !== null) {
        let chunkPromise = makeNextChunkPromise();
        askNextChunk();
        yield chunk as [Uint8Array, Uint8Array, Uint8Array];
        chunk = await chunkPromise;
    }
}

if (isMainThread) {
    // Nothing to do
} else {
    let iterator: AsyncIterableIterator<[Uint8Array, Uint8Array, Uint8Array]>;
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
                let [key, iv, encryptedDataChunk]: [Uint8Array, Uint8Array, Uint8Array] = value;
                parentPort!.postMessage([key, iv, encryptedDataChunk], [encryptedDataChunk.buffer]);
            }
        }
    });
}
