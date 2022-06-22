#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

import yargs from 'yargs';
import { WebUSB } from 'usb';
import {
    download,
    listDevice,
    getDeviceStatus,
    listContent,
    openNewDevice,
    Disc,
    countTracksInDisc,
    Device,
    EncodingName,
    Flag,
    ChannelName,
    upload,
} from './netmd-commands';
import { MDTrack, Wireformat } from './netmd-interface';
import {
    pad,
    formatTimeFromFrames,
    sanitizeTrackTitle,
    sleep,
    concatUint8Arrays,
    decryptDataFromFactoryTransfer,
    encryptDataForFactoryTransfer,
} from './utils';
import { DevicesIds } from './netmd';
import { makeGetAsyncPacketIteratorOnWorkerThread } from './node-encrypt-worker';
import { Worker } from 'worker_threads';
import readline from 'readline';
import { DiscFormat } from '.';
import { formatQuery } from './query-utils';
import { readUTOCSector } from './factory';

async function main() {
    const usb = new WebUSB({
        allowedDevices: DevicesIds.map(({ deviceId, vendorId }) => ({ deviceId, vendorId })),
        deviceTimeout: 1000000,
    });
    async function openDeviceOrExit(usb: USB) {
        let netmdInterface = await openNewDevice(usb);
        if (netmdInterface === null) {
            printNotDeviceFound();
            process.exit(1);
        }
        return netmdInterface;
    }

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
            'status [readIntervalMS]',
            'show device status',
            yargs => {
                return yargs.option('readIntervalMS', {
                    alias: 'i',
                    default: 0,
                    type: 'number',
                });
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                if (argv.readIntervalMS > 0) {
                    console.log('press Q to exit. Look at cli.js for other commands\n');
                    readline.emitKeypressEvents(process.stdin);
                    process.stdin.setRawMode(true);
                    process.stdin.on('keypress', async (str, key) => {
                        try {
                            switch (key.name) {
                                case 'q':
                                    process.exit(0);
                                    break;
                                case 'right':
                                    await netmdInterface.nextTrack();
                                    break;
                                case 'left':
                                    await netmdInterface.previousTrack();
                                    break;
                                case 'up':
                                    await netmdInterface.fast_forward();
                                    break;
                                case 'down':
                                    await netmdInterface.rewind();
                                    break;
                                case 'space':
                                    await netmdInterface.play();
                                    break;
                                case 'return':
                                    await netmdInterface.stop();
                                    break;
                                default:
                                    break;
                            }
                        } catch (e) {
                            console.log('Failed', (e as any).stack);
                        }
                    });
                }

                do {
                    const status = await getDeviceStatus(netmdInterface);
                    console.log(status);
                    await sleep(argv.readIntervalMS);
                } while (argv.readIntervalMS > 0);
            }
        )
        .command(
            'command [command]',
            'send command to device',
            yargs => {
                return yargs.positional('command', {
                    alias: 'c',
                    choices: ['play', 'stop', 'next', 'prev', 'eject'],
                });
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                const command = argv.command;
                switch (command) {
                    case 'play':
                        await netmdInterface.play();
                        break;
                    case 'stop':
                        await netmdInterface.stop();
                        break;
                    case 'next':
                        await netmdInterface.nextTrack();
                        break;
                    case 'prev':
                        await netmdInterface.previousTrack();
                        break;
                    case 'eject':
                        await netmdInterface.ejectDisc();
                        break;
                    default:
                        throw new Error(`Unexpected command ${command}`);
                }
            }
        )
        .command(
            'goto [track]',
            'go to specific track',
            yargs => {
                return yargs.positional('track', {
                    alias: 't',
                    type: 'number',
                    demandOption: true,
                });
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                await netmdInterface.gotoTrack(argv.track);
            }
        )
        .command(
            'll [command]',
            'send low level command to device',
            yargs => {
                return yargs.positional('command', {
                    type: 'string',
                    alias: 'c',
                    demandOption: true,
                });
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                console.log(await netmdInterface.sendQuery(formatQuery(argv.command as string)));
            }
        )
        .command(
            'wipe',
            'erase the disc',
            yargs => {},
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                await netmdInterface.eraseDisc();
            }
        )
        .command(
            'ls',
            'list device content',
            yargs => {},
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                let content = await listContent(netmdInterface);
                printDisc(content);
            }
        )
        .command(
            'set_raw_title [raw_title]',
            'set disc title and group info',
            yargs => {
                return yargs
                    .option('full_width', {
                        alias: 'w',
                        describe: 'Use the full width slot (Hiragana/Katakana/Kanji)',
                        default: false,
                        demandOption: false,
                        type: 'boolean',
                    })
                    .positional('raw_title', {
                        describe: 'new raw_title to set',
                        type: 'string',
                    })
                    .demandOption(['raw_title']);
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                await netmdInterface.setDiscTitle(argv.raw_title, argv.full_width);
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
                let netmdInterface = await openDeviceOrExit(usb);

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
                let mdTrack = new MDTrack(title, format, data.buffer, 0x100000 /* ~1Mb */, '', getAsyncPacketIteratorOnWorkerThread);

                let start = Date.now();
                await download(netmdInterface, mdTrack, progressCallback);
                let stop = Date.now();
                console.log('Time:', stop - start);
            }
        )
        .command(
            'download [track_number] [outputfile]',
            'download song from player to the PC. Track indexes start from 0. Only applicable to MZ-RH1 / MZ-M200',
            yargs => {
                return yargs
                    .positional('track_number', {
                        describe: 'track index',
                        type: 'number',
                        demandOption: true,
                    })
                    .positional('outputfile', {
                        describe: 'output file',
                        type: 'string',
                        demandOption: false,
                    });
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);

                const [format, data] = await upload(netmdInterface, argv.track_number, ({ readBytes, totalBytes }) => {
                    console.log(`Reading ${readBytes} / ${totalBytes}`);
                });

                const outfile =
                    argv.outputfile ||
                    `${await netmdInterface.getTrackTitle(argv.track_number)}.${
                        [DiscFormat.lp2, DiscFormat.lp4].includes(format) ? 'wav' : 'aea'
                    }`;

                fs.writeFileSync(outfile, data);
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
                    })
                    .option('full_width', {
                        alias: 'w',
                        describe: 'Use the full width slot (Hiragana/Katakana/Kanji)',
                        default: false,
                        demandOption: false,
                        type: 'boolean',
                    });
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                await netmdInterface.setTrackTitle(argv.track_number, argv.title, argv.full_width);
            }
        )
        .command(
            'move [src_track_number] [dst_track_number]',
            'move track. Track indexes start from 0',
            yargs => {
                return yargs
                    .positional('src_track_number', {
                        describe: 'Source track number',
                        type: 'number',
                        demandOption: true,
                    })
                    .positional('dst_track_number', {
                        describe: 'Destination track number',
                        type: 'number',
                        demandOption: true,
                    });
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                await netmdInterface.moveTrack(argv.src_track_number, argv.dst_track_number);
            }
        )
        /*
            At this point, it's impossible to implement write_utoc, as writing the metadata sections
            is not enough. The device caches the TOC stored in these sections, so triggering
            a TOC Edit on-device would flush the old TOC, partially cached in the device's
            system RAM to the metadata sections first, corrupting everything written using
            writeMetadataPeripheral. To write the TOC, an exploit has to be triggered to make
            the player skip the RAM to peripheral flush, and right now that's only possible using
            a USB buffer code execution exploit, which isn't part of netmd-js.
        */
        .command(
            'read_utoc [outputfile]',
            'Read the UTOC data from a recordable disc (Uses factory mode - only applicable for non-HiMD Sony (and some Aiwa) Portables)',
            yargs => {
                return yargs.positional('outputfile', {
                    describe: "The output files' path.",
                    demandOption: true,
                    type: 'string',
                });
            },
            async argv => {
                let netmdInterface = await openDeviceOrExit(usb);
                let factory = await netmdInterface.factory();
                for (let i = 0; i < 7; i++) {
                    const fileName = argv.outputfile + i.toString();
                    fs.writeFileSync(fileName, await readUTOCSector(factory, i));
                    console.log(`Written sector ${i} to file ${fileName}`);
                }
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
                } ${ChannelName[t.channel]} - ${t.title} | ${t.fullWidthTitle}`
            );
        }
    }
}

function printNotDeviceFound() {
    console.log(`No device found`);
}
