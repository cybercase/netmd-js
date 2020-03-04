import bunyan from 'bunyan';
import { usb } from 'webusb';
import fs from 'fs';

import { NetMD } from './netmd';
import { NetMDInterface, Encoding, Channels, TrackFlag, DiscFlag, MDTrack, MDSession, EKBOpenSource, Wireformat } from './netmdinterface';
import { assert, hexEncode, arrayBufferToBinaryString } from './utils';

const EncodingName: { [k: number]: string } = {
    [Encoding.sp]: 'sp',
    [Encoding.lp2]: 'lp2',
    [Encoding.lp4]: 'lp4',
};

const ChannelCount: { [k: number]: string } = {
    [Channels.mono]: 'mono',
    [Channels.stereo]: 'stereo',
};

const Flag: { [k: number]: string } = {
    [TrackFlag.protected]: 'protected',
    [TrackFlag.unprotected]: 'unprotected',
};

export async function listContent(mdIface: NetMDInterface) {
    function reprDiscFlags(flags: number) {
        let result: string[] = [];
        if (flags & DiscFlag.writable) {
            result.push('writable media');
        }
        if (flags & DiscFlag.writeProtected) {
            result.push('write-protected');
        }
        return result;
    }

    function timeToFrames(time: number[]) {
        assert(time.length === 4);
        return ((time[0] * 60 + time[1]) * 60 + time[2]) * 512 + time[3];
    }

    let flags = reprDiscFlags(await mdIface.getDiscFlags());
    console.log(`Disc ${flags.join(', ')}`, await mdIface.getDiscTitle(), await mdIface.getDiscTitle(true));

    const [discUsed, discTotal, discLeft] = await mdIface.getDiscCapacity();
    const discTotalTime = timeToFrames(discTotal);
    const discLeftTime = timeToFrames(discLeft);
    console.log(
        `Time used: ${discUsed[0]}:${discUsed[1]}:${discUsed[2]}+${discUsed[3]} (${((discTotalTime - discLeftTime) / discTotalTime) *
            100}%)`
    );

    const trackCount = await mdIface.getTrackCount();
    console.log(`${trackCount} Tracks`);

    const trackGroupList = await mdIface.getTrackGroupList();
    for (let [group, [groupName, trackLists]] of trackGroupList.entries()) {
        let prefix = '';
        if (groupName) {
            prefix = '   ';
            console.log(`Group ${groupName || group + 1}`);
        }
        for (let [trackIndex, track] of trackLists.entries()) {
            const [hour, minute, second, sample] = await mdIface.getTrackLength(track);
            const [codec, channelCount] = await mdIface.getTrackEncoding(track);
            const flags = await mdIface.getTrackFlags(track);
            console.log(
                `${prefix} ${trackIndex}: ${hour}:${minute}:${second}+${sample} ${EncodingName[codec]} ${ChannelCount[channelCount]} ${
                    Flag[flags]
                } ${await mdIface.getTrackTitle(track)}`
            );
        }
    }
}

function loadWAVTrackFromData(data: ArrayBuffer, title: string): MDTrack {
    let track = new MDTrack(title, Wireformat.pcm, data);
    return track;
}

async function download(mdIface: NetMDInterface) {
    try {
        await mdIface.sessionKeyForget();
        await mdIface.leaveSecureSession();
    } catch (err) {
        console.error(err);
        console.log('Ignored');
    }

    try {
        await mdIface.disableNewTrackProtection(1);
    } catch (err) {
        console.info("Can't set device to non-protecting");
    }

    const data = fs.readFileSync('./sesta.wav');
    const trk = loadWAVTrackFromData(data, 'sesta');

    const session = new MDSession(mdIface, new EKBOpenSource());
    await session.init();
    const [track, uuid, ccid] = await session.downloadTrack(trk);

    console.log(`Track: ${track}`);
    // console.log(`UUID: ${hexEncode(uuid)}`);
    // console.log(`Confirmed Content ID: ${hexEncode(ccid)}`);

    await session.close();
}

async function main() {
    const testLogger = bunyan.createLogger({ name: 'test', level: 'debug' });

    let device = await usb.requestDevice({ filters: [{ vendorId: 0x054c, productId: 0x00c8 }] });
    let netmd = new NetMD(device, 0, testLogger);
    await netmd.init();

    let mdIface = new NetMDInterface(netmd);

    try {
        // console.log('FATTO');
        // console.log(await mdIface.getDiscTitle(true));
        // (await mdIface.getTrackGroupList()).entries();
        // await listContent(mdIface);
        // await mdIface.getDiscFlags();
        await download(mdIface);
    } finally {
        await netmd.finalize();
    }
}

main().catch(err => {
    console.log(err);
});
