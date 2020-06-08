import fs from 'fs';

import { NetMD, DevicesIds } from './netmd';
import { NetMDInterface, Encoding, Channels, TrackFlag, DiscFlag, MDTrack, MDSession, EKBOpenSource, Wireformat } from './netmd-interface';
import { timeToFrames } from './utils';
import { Logger } from './logger';

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
    duration: number;
    channel: number;
    encoding: Encoding;
    protected: TrackFlag;
}

export interface Group {
    index: number;
    title: string | null;
    tracks: Track[];
}

export interface Disc {
    title: string;
    writable: boolean;
    writeProtected: boolean;
    used: number;
    left: number;
    total: number;
    trackCount: number;
    groups: Group[];
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
    const [discUsed, discTotal, discLeft] = await mdIface.getDiscCapacity();
    const trackCount = await mdIface.getTrackCount();

    let disc: Disc = {
        title: title,
        writable: !!(flags & DiscFlag.writable),
        writeProtected: !!(flags & DiscFlag.writeProtected),
        used: timeToFrames(discUsed),
        left: timeToFrames(discLeft),
        total: timeToFrames(discTotal),
        trackCount: trackCount,
        groups: [],
    };

    const trackGroupList = await mdIface.getTrackGroupList();

    for (let [groupIndex, [groupName, trackLists]] of trackGroupList.entries()) {
        let g: Group = {
            index: groupIndex,
            title: groupName,
            tracks: [],
        };
        disc.groups.push(g);

        let tracks: Track[] = [];
        for (let [trackIndex, track] of trackLists.entries()) {
            const title = await mdIface.getTrackTitle(track);
            const [codec, channel] = await mdIface.getTrackEncoding(track);
            const duration = timeToFrames(await mdIface.getTrackLength(track));
            const flags = await mdIface.getTrackFlags(track);
            let t = {
                index: track,
                title,
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

export async function download(
    mdIface: NetMDInterface,
    track: MDTrack,
    progressCallback?: (progress: { writtenBytes: number; totalBytes: number }) => void
) {
    try {
        await mdIface.sessionKeyForget();
        await mdIface.leaveSecureSession();
    } catch (err) {
        // Ignore. Assume there wasn't anything to finalize
    }

    await mdIface.disableNewTrackProtection(1);

    const session = new MDSession(mdIface, new EKBOpenSource());
    await session.init();
    const [trk, uuid, ccid] = await session.downloadTrack(track, progressCallback);

    await session.close();

    return [trk, uuid, ccid];
}
