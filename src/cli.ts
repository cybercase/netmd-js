#!/usr/bin/env node
import fs from 'fs';

import yargs from 'yargs';
import { usb } from 'webusb';
import { download, listDevice, listContent, openInterface, Disc, countTracksInDisc, Device } from './netmd-commands';
import { MDTrack, Wireformat } from './netmd-interface';
import { pad, formatTimeFromFrames, sanitizeTrackTitle } from './utils';
import { getAsyncPacketIterator } from './encrypt-generator';
import { getAsyncPacketIteratorOnWorkerThread } from './node-encrypt-worker';

async function main() {
    const args = yargs
        .command(
            'devices',
            'list devices',
            yargs => {},
            async argv => {
                let device = await listDevice(usb);
                printDevice(device);
            }
        )
        .command(
            'ls',
            'list device content',
            yargs => {},
            async argv => {
                let netmdInterface = await openInterface(usb);
                let content = await listContent(netmdInterface);
                printDisc(content);
            }
        )
        .command(
            'upload [inputfile]',
            'upload music to your device',
            yargs => {
                return yargs
                    .positional('inputfile', {
                        describe: 'music file to upload',
                        type: 'string',
                    })
                    .option('format', {
                        alias: 'f',
                        default: 's16be',
                        choices: ['s16be', 'lp2', 'lp105', 'lp4'],
                    })
                    .option('title', {
                        alias: 't',
                        type: 'string',
                    })
                    .demandOption(['inputfile']);
            },
            async argv => {
                const stringToWirefromat: { [k: string]: Wireformat } = {
                    s16be: Wireformat.pcm,
                    lp2: Wireformat.lp2,
                    lp105: Wireformat.l105kbps,
                    lp4: Wireformat.lp4,
                };

                const progressCallback = (progress: { writtenBytes: number; totalBytes: number }) => {
                    const { writtenBytes, totalBytes } = progress;
                    console.log(`Transferred bytes ${writtenBytes} of ${totalBytes}`, ~~((writtenBytes / totalBytes) * 100) + '%');
                };

                const data = fs.readFileSync(argv.inputfile);
                const format = stringToWirefromat[argv.format];
                const title = argv.title || sanitizeTrackTitle(argv.inputfile);

                // let worker = new NodeWorker('./dist/encrypt-worker.js');

                let mdTrack = new MDTrack(title, format, data.buffer, getAsyncPacketIteratorOnWorkerThread);

                let netmdInterface = await openInterface(usb);
                let start = Date.now();
                await download(netmdInterface, mdTrack, progressCallback);
                let stop = Date.now();
                console.log('Time:', stop - start);
            }
        )
        .option('verbose', {
            alias: 'v',
            type: 'boolean',
            description: 'Run with verbose logging',
        }).argv;
}

main().catch(err => {
    console.log(err);
});

function printDevice(device: Device) {
    console.log(`Found Device: ${device.name}`);
}

function printDisc(disc: Disc) {
    // prettier-ignore
    console.log(
        `Disc ` +
        (disc.writable ? `(writable media) ` : ``) +
        (disc.writeProtected ? `(write protected)` : ``)
    );

    console.log(`Time used ${formatTimeFromFrames(disc.used)}`);

    console.log(`${countTracksInDisc(disc)} tracks`);

    for (let g of disc.groups) {
        if (g.title !== null) {
            console.log(`Group '${g.title}'`);
        }
        for (let t of g.tracks) {
            console.log(
                `${g.title !== null ? '  ' : ''}${pad(t.index, '000')}: ${formatTimeFromFrames(t.duration)} - ${t.encoding} ${t.title}`
            );
        }
    }
}
