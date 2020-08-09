#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

import yargs from 'yargs';
import { usb } from 'webusb';
import {
    download,
    listDevice,
    listContent,
    openNewDevice,
    Disc,
    countTracksInDisc,
    Device,
    EncodingName,
    Flag,
    ChannelName,
} from './netmd-commands';
import { MDTrack, Wireformat } from './netmd-interface';
import { pad, formatTimeFromFrames, sanitizeTrackTitle } from './utils';
import { makeGetAsyncPacketIteratorOnWorkerThread } from './node-encrypt-worker';
import { Worker } from 'worker_threads';

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
                let netmdInterface = await openNewDevice(usb);
                if (netmdInterface === null) {
                    printNotDeviceFound();
                    return;
                }
                let content = await listContent(netmdInterface);
                printDisc(content);
            }
        )
        .command(
            'set_raw_title [raw_title]',
            'set disc title and group info',
            yargs => {
                return yargs
                    .positional('raw_title', {
                        describe: 'new raw_title to set',
                        type: 'string',
                    })
                    .demandOption(['raw_title']);
            },
            async argv => {
                let netmdInterface = await openNewDevice(usb);
                if (netmdInterface === null) {
                    printNotDeviceFound();
                    return;
                }

                await netmdInterface.setDiscTitle(argv.raw_title, false);
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
                        default: 'sp',
                        choices: ['sp', 'lp2', 'lp105', 'lp4'],
                    })
                    .option('title', {
                        alias: 't',
                        type: 'string',
                    })
                    .demandOption(['inputfile']);
            },
            async argv => {
                const stringToWirefromat: { [k: string]: Wireformat } = {
                    sp: Wireformat.pcm,
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

                const getAsyncPacketIteratorOnWorkerThread = makeGetAsyncPacketIteratorOnWorkerThread(
                    new Worker(path.join(__dirname, 'node-encrypt-worker.js'))
                );
                let mdTrack = new MDTrack(title, format, data.buffer, 0x100000 /* ~1Mb */, getAsyncPacketIteratorOnWorkerThread);

                let netmdInterface = await openNewDevice(usb);
                if (netmdInterface === null) {
                    printNotDeviceFound();
                    return;
                }

                let start = Date.now();
                await download(netmdInterface, mdTrack, progressCallback);
                let stop = Date.now();
                console.log('Time:', stop - start);
            }
        )
        .command(
            'rename [track_number] [title]',
            'set track title. Track indexes start from 0',
            yargs => {
                return yargs
                    .positional('title', {
                        describe: 'new title for track',
                        type: 'string',
                        demandOption: true,
                    })
                    .positional('track_number', {
                        describe: 'track index',
                        type: 'number',
                        demandOption: true,
                    });
            },
            async argv => {
                let netmdInterface = await openNewDevice(usb);
                if (netmdInterface === null) {
                    printNotDeviceFound();
                    return;
                }

                await netmdInterface.cacheTOC();
                await netmdInterface.setTrackTitle(argv.track_number, argv.title);
                await netmdInterface.syncTOC();
            }
        )
        .option('verbose', {
            alias: 'v',
            type: 'boolean',
            description: 'Run with verbose logging',
        })
        .demandCommand().argv;
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
    console.log(`Title: ` + disc.title);

    console.log(`Time used: ${formatTimeFromFrames(disc.used)}`);

    console.log(`${countTracksInDisc(disc)} tracks`);

    for (let g of disc.groups) {
        if (g.title !== null) {
            console.log(`Group '${g.title}'`);
        }
        for (let t of g.tracks) {
            console.log(
                `${g.title !== null ? '  ' : ''}${pad(t.index, '000')}: ${formatTimeFromFrames(t.duration)} - ${Flag[t.protected]} ${
                    EncodingName[t.encoding]
                } ${ChannelName[t.channel]} - ${t.title}`
            );
        }
    }
}

function printNotDeviceFound() {
    console.log(`No device found`);
}
