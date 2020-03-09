import { getAsyncPacketIterator } from './encrypt-generator';

// This generator uses a worker thread to encrypt the nextChunk
// while yielding the current one.
export function makeGetAsyncPacketIteratorOnWorkerThread(worker: Worker) {
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
        w.onmessage = (ev: MessageEvent) => {
            resolver(ev.data);
        };

        let chunks: Promise<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array } | null>[] = [];
        const queueNextChunk = () => {
            let chunkPromise = new Promise<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array } | null>(resolve => {
                resolver = data => {
                    if (data !== null) {
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
            const { data, frameSize, kek } = others;
            iterator = getAsyncPacketIterator({ data, frameSize, kek });
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
