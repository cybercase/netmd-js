import fs from 'fs';

import { NetMD, DevicesIds } from './netmd';
import { NetMDInterface, Encoding, Channels, TrackFlag, DiscFlag, MDTrack, MDSession, EKBOpenSource, Wireformat } from './netmd-interface';
import {
    timeToFrames,
    sanitizeHalfWidthTitle,
    sanitizeFullWidthTitle,
    sleep,
    createAeaHeader,
    createWavHeader,
    concatUint8Arrays,
    getHalfWidthTitleLength,
    halfWidthToFullWidthRange,
} from './utils';
import { Logger } from './logger';
import { Descriptor, DescriptorAction, DiscFormat } from '.';

export const EncodingName: { [k: number]: string } = {
    [Encoding.sp]: 'sp',
    [Encoding.lp2]: 'lp2',
    [Encoding.lp4]: 'lp4',
};

export const ChannelName: { [k: number]: string } = {
    [Channels.mono]: 'mono',
    [Channels.stereo]: 'stereo',
};

export const Flag: { [k: number]: string } = {
    [TrackFlag.protected]: 'protected',
    [TrackFlag.unprotected]: 'unprotected',
};

export async function openPairedDevice(usb: USB, logger?: Logger) {
    let devices = await usb.getDevices();
    if (devices.length === 0) {
        return null; // No device found
    }

    let netmd = new NetMD(devices[0], 0, logger);
    await netmd.init();
    return new NetMDInterface(netmd, logger);
}

export async function openNewDevice(usb: USB, logger?: Logger) {
    let filters = DevicesIds.map(({ vendorId, deviceId }) => ({ vendorId, deviceId }));
    let device: USBDevice;
    try {
        device = await usb.requestDevice({ filters });
    } catch (err) {
        return null; // No device found or not allowed by the user
    }
    let netmd = new NetMD(device, 0, logger);
    await netmd.init();
    return new NetMDInterface(netmd, logger);
}

export interface Device {
    manufacturerName: string;
    productName: string;
    vendorId: number;
    productId: number;
    name: string;
}
export async function listDevice(usb: USB) {
    let filters = DevicesIds.map(({ vendorId, deviceId }) => ({ vendorId, deviceId }));
    let device = await usb.requestDevice({ filters });
    let id = DevicesIds.find(did => {
        return did.deviceId == device.productId && did.vendorId === device.vendorId;
    });

    let d: Device = {
        manufacturerName: device.manufacturerName ?? 'unknown',
        productName: device.productName ?? 'unknown',
        vendorId: device.vendorId,
        productId: device.productId,
        name: id?.name ?? 'unknown',
    };
    return d;
}

export interface Track {
    index: number;
    title: string | null;
    fullWidthTitle: string | null;
    duration: number;
    channel: number;
    encoding: Encoding;
    protected: TrackFlag;
}

export interface Group {
    index: number;
    title: string | null;
    fullWidthTitle: string | null;
    tracks: Track[];
}

export interface Disc {
    title: string;
    fullWidthTitle: string;
    writable: boolean;
    writeProtected: boolean;
    used: number;
    left: number;
    total: number;
    trackCount: number;
    groups: Group[];
}

const OperatingStatus = {
    50687: 'ready',
    50037: 'playing',
    50045: 'paused',
    49983: 'fastForward',
    49999: 'rewind',
    65315: 'readingTOC',
    65296: 'noDisc',
    65535: 'discBlank',
} as const;
type OperatingStatusType = typeof OperatingStatus[keyof typeof OperatingStatus] | 'unknown';

export interface DeviceStatus {
    discPresent: boolean;
    time: { minute: number; second: number; frame: number } | null;
    track: number | null;
    state: OperatingStatusType;
}

export async function getDeviceStatus(mdIface: NetMDInterface): Promise<DeviceStatus> {
    const status = await mdIface.getStatus();
    const playbackStatus2 = await mdIface.getPlaybackStatus2();
    const [b1, b2] = [playbackStatus2[4], playbackStatus2[5]];
    const operatingStatus = (b1 << 8) | b2;
    const position = await mdIface.getPosition();

    const track = position ? position[0] : null;
    const discPresent = status[4] !== 0x80;
    let state: OperatingStatusType =
        operatingStatus in OperatingStatus ? OperatingStatus[operatingStatus as keyof typeof OperatingStatus] : 'unknown';
    if (state === 'playing' && !discPresent) {
        state = 'ready';
    }

    const time = position
        ? {
              minute: position[2],
              second: position[3],
              frame: position[4],
          }
        : null;

    return {
        discPresent: discPresent && !['readingTOC', 'noDisc'].includes(state),
        state,
        track,
        time,
    };
}

export function countTracksInDisc(disc: Disc): number {
    return disc.groups.reduce((acc, g, _) => {
        return acc + g.tracks.length;
    }, 0);
}

export function getTracks(disc: Disc): Track[] {
    let tracks: Track[] = [];
    for (let group of disc.groups) {
        for (let track of group.tracks) {
            tracks.push(track);
        }
    }
    return tracks;
}

export async function listContent(mdIface: NetMDInterface) {
    let flags = await mdIface.getDiscFlags();
    const title = await mdIface.getDiscTitle();
    const fullWidthTitle = await mdIface.getDiscTitle(true);
    const [discUsed, discTotal, discLeft] = await mdIface.getDiscCapacity();
    const trackCount = await mdIface.getTrackCount();

    let disc: Disc = {
        title: title,
        fullWidthTitle: fullWidthTitle,
        writable: !!(flags & DiscFlag.writable),
        writeProtected: !!(flags & DiscFlag.writeProtected),
        used: timeToFrames(discUsed),
        left: timeToFrames(discLeft),
        total: timeToFrames(discTotal),
        trackCount: trackCount,
        groups: [],
    };

    const trackGroupList = await mdIface.getTrackGroupList();

    for (let [groupIndex, [groupName, fullWidthName, trackLists]] of trackGroupList.entries()) {
        let g: Group = {
            index: groupIndex,
            title: groupName,
            fullWidthTitle: fullWidthName,
            tracks: [],
        };
        disc.groups.push(g);

        let tracks: Track[] = [];
        for (let [trackIndex, track] of trackLists.entries()) {
            const title = await mdIface.getTrackTitle(track);
            const fullWidthTitle = await mdIface.getTrackTitle(track, true);
            const [codec, channel] = await mdIface.getTrackEncoding(track);
            const duration = timeToFrames(await mdIface.getTrackLength(track));
            const flags = await mdIface.getTrackFlags(track);
            let t = {
                index: track,
                title,
                fullWidthTitle,
                duration,
                channel: channel,
                encoding: codec as Encoding,
                protected: flags as TrackFlag,
            };
            tracks.push(t);
        }
        g.tracks = g.tracks.concat(tracks);
    }

    return disc;
}

const fixLength = (len: number) => Math.ceil(len / 7);

export function getCellsForTitle(trk: Track) {
    // Sometimes 'LP: ' is added to track names even if the title is '' (+1 cell)
    return Math.max(1, fixLength((trk.fullWidthTitle?.length ?? 0) * 2)) + Math.max(1, fixLength(getHalfWidthTitleLength(trk.title ?? '')));
}

export function getRemainingCharactersForTitles(disc: Disc, includeGroups?: boolean) {
    const cellLimit = 255;
    // see https://www.minidisc.org/md_toc.html

    let groups = disc.groups.filter(n => n.title !== null);

    // Assume worst-case scenario
    let fwTitle = disc.fullWidthTitle + `0;//`;
    let hwTitle = disc.title + `0;//`;
    if (includeGroups || includeGroups === undefined)
        for (let group of groups) {
            let range = `${group.tracks[0].index + 1}${group.tracks.length - 1 !== 0 &&
                `-${group.tracks[group.tracks.length - 1].index + 1}`}//`;
            // The order of these characters doesn't matter. It's for length only
            fwTitle += group.fullWidthTitle + range;
            hwTitle += group.title + range;
        }

    let usedCells = 0;
    usedCells += fixLength(fwTitle.length * 2);
    usedCells += fixLength(getHalfWidthTitleLength(hwTitle));
    for (let trk of getTracks(disc)) {
        usedCells += getCellsForTitle(trk);
    }
    return Math.max(cellLimit - usedCells, 0) * 7;
}

export function compileDiscTitles(disc: Disc) {
    let availableCharactersForTitle = getRemainingCharactersForTitles(
        {
            ...disc,
            title: '',
            fullWidthTitle: '',
        },
        false
    );
    // If the disc or any of the groups, or any track has a full-width title, provide support for them
    const useFullWidth =
        disc.fullWidthTitle ||
        disc.groups.filter(n => !!n.fullWidthTitle).length > 0 ||
        disc.groups
            .map(n => n.tracks)
            .reduce((a, b) => a.concat(b), [])
            .filter(n => !!n.fullWidthTitle).length > 0;

    let newRawTitle = '',
        newRawFullWidthTitle = '';
    if (disc.title) newRawTitle = `0;${disc.title}//`;
    if (useFullWidth) newRawFullWidthTitle = `０；${disc.fullWidthTitle}／／`;
    for (let n of disc.groups) {
        if (n.title === null || n.tracks.length === 0) continue;
        let range = `${n.tracks[0].index + 1}`;
        if (n.tracks.length !== 1) {
            // Special case
            range += `-${n.tracks[0].index + n.tracks.length}`;
        }

        let newRawTitleAfterGroup = newRawTitle + `${range};${n.title}//`,
            newRawFullWidthTitleAfterGroup = newRawFullWidthTitle + halfWidthToFullWidthRange(range) + `；${n.fullWidthTitle ?? ''}／／`;

        let titlesLengthInTOC = fixLength(getHalfWidthTitleLength(newRawTitleAfterGroup)) * 7;

        if (useFullWidth) titlesLengthInTOC += fixLength(newRawFullWidthTitleAfterGroup.length * 2) * 7;

        if (availableCharactersForTitle - titlesLengthInTOC < 0) break;

        newRawTitle = newRawTitleAfterGroup;
        newRawFullWidthTitle = newRawFullWidthTitleAfterGroup;
    }

    let titlesLengthInTOC = fixLength(getHalfWidthTitleLength(newRawTitle)) * 7;
    if (useFullWidth) titlesLengthInTOC += fixLength(newRawFullWidthTitle.length * 2); // If this check fails the titles without the groups already take too much space, don't change anything
    if (availableCharactersForTitle - titlesLengthInTOC < 0) {
        return null;
    }

    return {
        newRawTitle,
        newRawFullWidthTitle: useFullWidth ? newRawFullWidthTitle : '',
    };
}

export async function rewriteDiscGroups(mdIface: NetMDInterface, disc: Disc) {
    const compiled = compileDiscTitles(disc);
    if (!compiled) return;
    const { newRawTitle, newRawFullWidthTitle } = compiled;
    await mdIface.setDiscTitle(newRawTitle);
    await mdIface.setDiscTitle(newRawFullWidthTitle, true);
}

export async function renameDisc(mdIface: NetMDInterface, newName: string, newFullWidthName?: string) {
    newName = sanitizeHalfWidthTitle(newName);
    newFullWidthName = newFullWidthName !== undefined ? sanitizeFullWidthTitle(newFullWidthName) : undefined;

    const oldName = await mdIface.getDiscTitle();
    const oldFullWidthName = await mdIface.getDiscTitle(true);
    const oldRawName = await mdIface._getDiscTitle();
    const oldRawFullWidthName = await mdIface._getDiscTitle(true);
    const hasGroups = oldRawName.indexOf('//') >= 0;
    const hasFullWidthGroups = oldRawName.indexOf('／／') >= 0;
    const hasGroupsAndTitle = oldRawName.startsWith('0;');
    const hasFullWidthGroupsAndTitle = oldRawName.startsWith('０；');

    if (newFullWidthName !== oldFullWidthName && newFullWidthName !== undefined) {
        let newFullWidthNameWithGroups;
        if (hasFullWidthGroups) {
            if (hasFullWidthGroupsAndTitle) {
                newFullWidthNameWithGroups = oldRawFullWidthName.replace(
                    /^０；.*?／／/,
                    newFullWidthName !== '' ? `０；${newFullWidthName}／／` : ``
                );
            } else {
                newFullWidthNameWithGroups = `０；${newFullWidthName}／／${oldRawFullWidthName}`; // Add the new title
            }
        } else {
            newFullWidthNameWithGroups = newFullWidthName;
        }
        await mdIface.setDiscTitle(newFullWidthNameWithGroups, true);
    }

    if (newName === oldName) {
        return;
    }

    let newNameWithGroups;

    if (hasGroups) {
        if (hasGroupsAndTitle) {
            newNameWithGroups = oldRawName.replace(/^0;.*?\/\//, newName !== '' ? `0;${newName}//` : ``); // Replace or delete the old title
        } else {
            newNameWithGroups = `0;${newName}//${oldRawName}`; // Add the new title
        }
    } else {
        newNameWithGroups = newName;
    }

    await mdIface.setDiscTitle(newNameWithGroups);
}

export async function upload(
    mdIface: NetMDInterface,
    track: number,
    progressCallback?: (progress: { readBytes: number; totalBytes: number }) => void
): Promise<[DiscFormat, Uint8Array]> {
    const [format, frames, result] = await mdIface.saveTrackToArray(track, (l, r) => {
        progressCallback && progressCallback({ totalBytes: l, readBytes: r });
    });
    let header;
    switch (format) {
        case DiscFormat.spStereo:
        case DiscFormat.spMono:
            header = createAeaHeader(await mdIface.getTrackTitle(track), format === DiscFormat.spStereo ? 2 : 1, frames);
            break;
        case DiscFormat.lp2:
        case DiscFormat.lp4:
            header = createWavHeader(format, result.length);
            break;
    }
    return [format, concatUint8Arrays(header, result)];
}

export async function download(
    mdIface: NetMDInterface,
    track: MDTrack,
    progressCallback?: (progress: { writtenBytes: number; totalBytes: number }) => void
) {
    // Sometimes netmd-js sends the setupDownload command prematurely, causing it to be rejected.
    // Wait for the device to be ready before sending the (next) track.
    while (!['ready', 'discBlank'].includes((await getDeviceStatus(mdIface)).state)) {
        await sleep(200);
    }
    try {
        await mdIface.sessionKeyForget();
        await mdIface.leaveSecureSession();
    } catch (err) {
        // Ignore. Assume there wasn't anything to finalize
    }

    await mdIface.acquire();
    try {
        await mdIface.disableNewTrackProtection(1);
    } catch (err) {
        // Ignore. On Sharp devices this doesn't work anyway.
    }

    const session = new MDSession(mdIface, new EKBOpenSource());
    await session.init();
    const [trk, uuid, ccid] = await session.downloadTrack(track, progressCallback);

    await session.close();
    await mdIface.release();

    return [trk, uuid, ccid];
}
