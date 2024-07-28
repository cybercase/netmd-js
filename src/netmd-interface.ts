import { NetMD } from './netmd';
import { Logger } from './logger';
import { formatQuery, scanQuery } from './query-utils';
import {
    concatArrayBuffers,
    stringToCharCodeArray,
    assert,
    isBigEndian,
    concatUint8Arrays,
    wordArrayToByteArray,
    getLengthAfterEncodingToSJIS,
    encodeToSJIS,
    decodeFromSJIS,
    sleep,
    halfWidthToFullWidthRange,
    sanitizeFullWidthTitle,
    sanitizeHalfWidthTitle,
} from './utils';
import JSBI from 'jsbi';
import Crypto from '@originjs/crypto-js-wasm';

import { NetMDNotImplemented, NetMDRejected, Status } from './netmd-shared-objects';
import { HiMDFactoryInterface, NetMDFactoryInterface, RH1FactoryInterface } from './factory/netmd-factory-interface';
import { getDescriptiveDeviceCode } from './factory';
import { EKB, getEKBForDevice } from './netmd-ekb';

enum Action {
    play = 0x75,
    pause = 0x7d,
    fastForward = 0x39,
    rewind = 0x49,
}

enum Track {
    previous = 0x0002,
    next = 0x8001,
    restart = 0x0001,
}

export enum DiscFormat {
    lp4 = 0,
    lp2 = 2,
    spMono = 4,
    spStereo = 6,
}

export enum Wireformat {
    pcm = 0,
    l105kbps = 0x90,
    lp2 = 0x94,
    lp4 = 0xa8,
}

export enum Encoding {
    sp = 0x90,
    lp2 = 0x92,
    lp4 = 0x93,
}

export enum Channels {
    mono = 0x01,
    stereo = 0x00,
}

export enum ChannelCount {
    mono = 1,
    stereo = 2,
}

export enum TrackFlag {
    protected = 0x03,
    unprotected = 0x00,
}

export enum DiscFlag {
    writable = 0x10,
    writeProtected = 0x40,
}

export enum NetMDLevel {
    level1 = 0x20, // Network MD
    level2 = 0x50, // Program play MD
    level3 = 0x70, // Editing MD
}

export enum Descriptor {
    // TD - text database
    discTitleTD = '10 1801',
    audioUTOC1TD = '10 1802',
    audioUTOC4TD = '10 1803',
    DSITD = '10 1804',
    audioContentsTD = '10 1001',
    rootTD = '10 1000',

    discSubunitIndentifier = '00',
    operatingStatusBlock = '80 00', // Real name unknown
}

export enum DescriptorAction {
    openRead = '01',
    openWrite = '03',
    close = '00',
}

export const FrameSize: { [k: number]: number } = {
    [Wireformat.pcm]: 2048,
    [Wireformat.lp2]: 192,
    [Wireformat.l105kbps]: 152,
    [Wireformat.lp4]: 96,
};

export class NetMDInterface {
    static maxInterimReadAttempts = 4;
    static interimResponseRetryIntervalInMs = 100;
    constructor(public netMd: NetMD, private logger?: Logger) {
        this.logger = logger?.child({ class: 'NetMDInterface' });
    }

    async _getDiscSubunitIdentifier() {
        await this.changeDescriptorState(Descriptor.discSubunitIndentifier, DescriptorAction.openRead);
        const query = formatQuery('1809 00 ff00 0000 0000');
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1809 00 1000 %?%? %?%? %w %b %b %b %b %w %*');

        // Decoding the structure
        const descriptorLength = JSBI.toNumber(res[0] as JSBI);
        const generationID = JSBI.toNumber(res[1] as JSBI);
        const sizeOfListID = JSBI.toNumber(res[2] as JSBI);
        const sizeOfObjectID = JSBI.toNumber(res[3] as JSBI);
        const sizeOfObjectPosition = JSBI.toNumber(res[4] as JSBI);
        const amtOfRootObjectLists = JSBI.toNumber(res[5] as JSBI);
        const buffer = res[6] as Uint8Array;
        const rootObjects = [];

        let bufferOffset = 0;

        function constructMultibyte(n: number) {
            let output = 0;
            for (let i = 0; i < n; i++) {
                output <<= 8;
                output |= buffer[bufferOffset++];
            }
            return output;
        }

        for (let i = 0; i < amtOfRootObjectLists; i++) {
            rootObjects.push(constructMultibyte(sizeOfListID));
        }

        const subunitDependentLength = constructMultibyte(2);
        const subunitFieldsLength = constructMultibyte(2);
        const attributes = buffer[bufferOffset++];
        const discSubunitVersion = buffer[bufferOffset++];

        const supportedMediaTypeSpecifications: { [key: number]: any } = {};
        const amtSupportedMediaTypes = buffer[bufferOffset++];
        for (let i = 0; i < amtSupportedMediaTypes; i++) {
            const supportedMediaType = constructMultibyte(2);

            const implentationProfileID = buffer[bufferOffset++];
            const mediaTypeAttributes = buffer[bufferOffset++];
            const typeDepLength = constructMultibyte(2);

            const mdAudioVersion = buffer[bufferOffset++];
            const supportsMDClip = buffer[bufferOffset++];
            supportedMediaTypeSpecifications[supportedMediaType] = {
                supportedMediaType,
                implentationProfileID,
                mediaTypeAttributes,
                mdAudioVersion,
                supportsMDClip,
            };
        }

        assert(Object.keys(supportedMediaTypeSpecifications).includes('769'), "This Minidisc recorder doesn't support Minidiscs");

        const manufacturerDepLength = constructMultibyte(2);
        const manufacturerDepData = buffer.slice(bufferOffset, bufferOffset + manufacturerDepLength);

        await this.changeDescriptorState(Descriptor.discSubunitIndentifier, DescriptorAction.close);
        return {
            netMDLevel: supportedMediaTypeSpecifications[0x301].implentationProfileID as NetMDLevel,
        };
    }

    async factory() {
        const deviceName = this.netMd.getDeviceName();
        const himd = deviceName.includes('MZ-RH') || deviceName.includes("MZ-NH") || deviceName.includes("DS-HMD1");
        
        await this._getDiscSubunitIdentifier();
        const constructor = himd ? HiMDFactoryInterface : NetMDFactoryInterface;
        let factoryIface = new constructor(this.netMd, this.logger);
        await factoryIface.auth();
        const deviceCode = await getDescriptiveDeviceCode(factoryIface);
        if(deviceCode.startsWith("Hx")){
            // This is an MZ-RH1 - switch to the other interface
            factoryIface = new RH1FactoryInterface(this.netMd, this.logger);
        }
        return factoryIface;
    }

    async getNetMDLevel() {
        return (await this._getDiscSubunitIdentifier()).netMDLevel;
    }

    async changeDescriptorState(descriptor: Descriptor, action: DescriptorAction) {
        try {
            await this.sendQuery(formatQuery(`1808 ${descriptor} ${action} 00`));
        } catch (ex) {
            this.logger?.error({ method: 'changeDescriptorState', error: ex, descriptor, action });
        }
    }

    async sendQuery(query: ArrayBuffer, test = false, acceptInterim = false) {
        await this.sendCommand(query, test);
        return this.readReply(acceptInterim);
    }

    async sendCommand(query: ArrayBuffer, test = false) {
        let statusByte: ArrayBuffer;
        if (test) {
            statusByte = new Uint8Array([Status.specificInquiry]).buffer;
        } else {
            statusByte = new Uint8Array([Status.control]).buffer;
        }
        await this.netMd.sendCommand(concatArrayBuffers(statusByte, query));
    }

    async readReply(acceptInterim = false) {
        let currentAttempt = 0;
        let data: DataView | undefined;
        while (currentAttempt < NetMDInterface.maxInterimReadAttempts) {
            ({ data } = await this.netMd.readReply());
            if (data === undefined) {
                throw new Error('unexpected undefined value in readReply');
            }

            let status = data.getUint8(0);
            if (status === Status.notImplemented) {
                throw new NetMDNotImplemented('Not implemented');
            } else if (status === Status.rejected) {
                throw new NetMDRejected(
                    `Rejected - ${[...new Uint8Array(data.buffer)].map(n => n.toString(16).padStart(2, '0')).join('')}`
                );
            } else if (status === Status.interim && !acceptInterim) {
                await sleep(NetMDInterface.interimResponseRetryIntervalInMs * (Math.pow(2, currentAttempt) - 1));
                currentAttempt += 1;
                continue; // Retry
            } else if ([Status.accepted, Status.implemented, Status.interim].indexOf(status) < -1) {
                throw new NetMDNotImplemented(`Unknown return status: ${status}`);
            } else {
                break; // Success!
            }
        }
        if (currentAttempt >= NetMDInterface.maxInterimReadAttempts) {
            throw new NetMDRejected('Max attempts read attempts for interim status reached');
        }
        return data!.buffer.slice(1);
    }

    async acquire() {
        const query = formatQuery('ff 010c ffff ffff ffff ffff ffff ffff');
        const reply = await this.sendQuery(query);
        scanQuery(reply, 'ff 010c ffff ffff ffff ffff ffff ffff');
    }

    async release() {
        const query = formatQuery('ff 0100 ffff ffff ffff ffff ffff ffff');
        const reply = await this.sendQuery(query);
        scanQuery(reply, 'ff 0100 ffff ffff ffff ffff ffff ffff');
    }

    async getStatus() {
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.openRead);
        const query = formatQuery('1809 8001 0230 8800 0030 8804 00 ff00 00000000');
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1809 8001 0230 8800 0030 8804 00 1000 00090000 %x');
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.close);
        return res[0] as Uint8Array;
    }

    async isDiscPresent() {
        const status = await this.getStatus();
        return status[4] === 0x40;
    }

    async getFullOperatingStatus() {
        // WARNING: Does not work for all devices. See https://github.com/cybercase/webminidisc/issues/21
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.openRead);
        const query = formatQuery('1809 8001 0330 8802 0030 8805 0030 8806 00 ff00 00000000');
        const reply = await this.sendQuery(query);
        let result = scanQuery(reply, '1809 8001 0330 8802 0030 8805 0030 8806 00 1000 00%?0000 00%b 8806 %x');
        let operatingStatus = result[1] as Uint8Array;
        let statusMode = JSBI.toNumber(result[0] as JSBI);
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.close);
        if (operatingStatus.length < 2) throw new Error('Unparsable operating status');
        let operatingStatusNumber = (operatingStatus[0] << 8) | operatingStatus[1];
        return [statusMode, operatingStatusNumber];
    }

    async getOperatingStatus() {
        return (await this.getFullOperatingStatus())[1];
    }

    async _getPlaybackStatus(p1: number, p2: number) {
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.openRead);
        const query = formatQuery('1809 8001 0330 %w 0030 8805 0030 %w 00 ff00 00000000', p1, p2);
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1809 8001 0330 %?%? %?%? %?%? %?%? %?%? %? 1000 00%?0000 %x %?'); //Fix MZ-RH1 not launching
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.close);
        return res[0] as Uint8Array;
    }

    async getPlaybackStatus1() {
        return this._getPlaybackStatus(0x8801, 0x8807);
    }

    async getPlaybackStatus2() {
        return this._getPlaybackStatus(0x8802, 0x8806);
    }

    async getPosition() {
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.openRead);
        const query = formatQuery('1809 8001 0430 8802 0030 8805 0030 0003 0030 0002 00 ff00 00000000');
        let reply;
        try {
            reply = await this.sendQuery(query);
        } catch (err) {
            if (err instanceof NetMDRejected) {
                return null;
            } else {
                throw err;
            }
        }
        let result = scanQuery(
            reply,
            `1809 8001 0430 %?%? %?%? %?%? ` + `%?%? %?%? %?%? %?%? %? %?00 00%?0000 ` + `000b 0002 0007 00 %w %B %B %B %B`
        );

        result[0] = JSBI.toNumber(result[0] as JSBI);

        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.close);

        return result as number[];
    }

    async ejectDisc() {
        const query = formatQuery('18c1 ff 6000');
        const reply = await this.sendQuery(query);
    }

    async canEjectDisc() {
        try {
            await this.sendQuery(formatQuery('18c1 ff 6000'), true);
            return true;
        } catch (err) {
            return false;
        }
    }

    async _play(action: number) {
        const query = formatQuery('18c3 ff %b 000000', action);
        const reply = await this.sendQuery(query);
        scanQuery(reply, '18c3 00 %b 000000');
    }

    async play() {
        await this._play(Action.play);
    }

    async fast_forward() {
        await this._play(Action.fastForward);
    }

    async rewind() {
        await this._play(Action.rewind);
    }

    async pause() {
        await this._play(Action.pause);
    }

    async stop() {
        try {
            const query = formatQuery('18c5 ff 00000000');
            const reply = await this.sendQuery(query);
            scanQuery(reply, '18c5 00 00000000');
        } catch (ex) {
            // Ignore (fix for LAM-1)
        }
    }

    async gotoTrack(track: number) {
        const query = formatQuery('1850 ff010000 0000 %w', track);
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1850 00010000 0000 %w')[0] as JSBI;
        return JSBI.toNumber(res);
    }

    async gotoTime(track: number, hour = 0, minute = 0, second = 0, frame = 0) {
        const query = formatQuery('1850 ff000000 0000 %w %B%B%B%B', track, hour, minute, second, frame);
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1850 00000000 %?%? %w %B%B%B%B');
        res[0] = JSBI.toNumber(res[0] as JSBI);
        return res;
    }

    async _trackChange(direction: number) {
        const query = formatQuery('1850 ff10 00000000 %w', direction);
        const reply = await this.sendQuery(query);
        return scanQuery(reply, '1850 0010 00000000 %?%?');
    }

    async nextTrack() {
        await this._trackChange(Track.next);
    }

    async previousTrack() {
        await this._trackChange(Track.previous);
    }

    async restartTrack() {
        await this._trackChange(Track.restart);
    }

    async eraseDisc() {
        const query = formatQuery('1840 ff 0000');
        const reply = await this.sendQuery(query);
        scanQuery(reply, '1840 00 0000');
    }

    async getDiscFlags() {
        await this.changeDescriptorState(Descriptor.rootTD, DescriptorAction.openRead);
        const query = formatQuery('1806 01101000 ff00 0001000b');
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1806 01101000 1000 0001000b %b');
        await this.changeDescriptorState(Descriptor.rootTD, DescriptorAction.close);
        return JSBI.toNumber(res[0] as JSBI);
    }

    async getTrackCount() {
        await this.changeDescriptorState(Descriptor.audioContentsTD, DescriptorAction.openRead);
        const query = formatQuery('1806 02101001 3000 1000 ff00 00000000');
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1806 02101001 %?%? %?%? 1000 00%?0000 0006 0010000200%b');
        let trackCount = JSBI.toNumber(res[0] as JSBI);
        this.logger?.debug({ method: `getTrackCount`, result: trackCount });
        await this.changeDescriptorState(Descriptor.audioContentsTD, DescriptorAction.close);
        return trackCount;
    }

    async _getDiscTitle(wchar = false) {
        await this.changeDescriptorState(Descriptor.audioContentsTD, DescriptorAction.openRead);
        await this.changeDescriptorState(Descriptor.discTitleTD, DescriptorAction.openRead);
        let wcharValue;
        if (wchar) {
            wcharValue = 1;
        } else {
            wcharValue = 0;
        }
        let done = 0;
        let remaining = 0;
        let total = 1;
        let result: string[] = [];
        let chunkSize: number;
        let chunk: string;
        while (done < total) {
            const query = formatQuery('1806 02201801 00%b 3000 0a00 ff00 %w%w', wcharValue, remaining, done);
            const reply = await this.sendQuery(query);
            if (remaining === 0) {
                let res = scanQuery(reply, '1806 02201801 00%? 3000 0a00 1000 %w0000 %?%?000a %w %*');
                chunkSize = JSBI.toNumber(res[0] as JSBI);
                total = JSBI.toNumber(res[1] as JSBI);
                chunk = decodeFromSJIS(res[2] as Uint8Array);
                chunkSize -= 6;
            } else {
                let res = scanQuery(reply, '1806 02201801 00%? 3000 0a00 1000 %w%?%? %*');
                chunkSize = JSBI.toNumber(res[0] as JSBI);
                chunk = decodeFromSJIS(res[1] as Uint8Array);
            }
            result.push(chunk);
            done += chunkSize;
            remaining = total - done;
        }
        let res = result.join('');
        this.logger?.debug({ method: `_getDiscTitle`, result: res });
        await this.changeDescriptorState(Descriptor.discTitleTD, DescriptorAction.close);
        await this.changeDescriptorState(Descriptor.audioContentsTD, DescriptorAction.close);
        return res;
    }

    async getDiscTitle(wchar = false) {
        let title = await this._getDiscTitle(wchar);

        const delim = wchar ? '／／' : '//';
        const titleMarker = wchar ? '０；' : '0;';

        if (title.endsWith(delim)) {
            let firstEntry = title.split(delim)[0];
            if (firstEntry.startsWith(titleMarker)) {
                title = firstEntry.substring(2);
            } else {
                title = '';
            }
        }
        return title;
    }

    async getTrackGroupList() {
        let rawTitle = await this._getDiscTitle();
        let groupList = rawTitle.split('//');
        let trackDict: { [k: number]: [string, number] } = {};
        let trackCount = await this.getTrackCount();
        let result: [string | null, string | null, number[]][] = [];
        let rawFullTitle = await this._getDiscTitle(true);
        let fullWidthGroupList = rawFullTitle.split('／／');

        for (const [groupIndex, group] of groupList.entries()) {
            if (group === '') {
                continue;
            }
            if (group.startsWith('0;') || group.indexOf(';') === -1 || rawTitle.indexOf('//') === -1) {
                continue;
            }
            const [trackRange] = group.split(';', 1);
            if (trackRange === '') continue;
            const groupName = group.substring(trackRange.length + 1);

            const fullWidthRange = halfWidthToFullWidthRange(trackRange);
            const fullWidthGroupName = fullWidthGroupList.find(n => n.startsWith(fullWidthRange))?.substring(fullWidthRange.length + 1);

            let trackMinStr: string, trackMaxStr: string;
            if (trackRange.indexOf('-') >= 0) {
                [trackMinStr, trackMaxStr] = trackRange.split('-');
            } else {
                trackMinStr = trackMaxStr = trackRange;
            }
            let [trackMin, trackMax] = [Number.parseInt(trackMinStr, 10), Number.parseInt(trackMaxStr, 10)];
            trackMax = Math.min(trackMax, trackCount); // Groups might not updated when a song is deleted
            assert(0 <= trackMin);
            assert(trackMin <= trackMax);

            let trackList: number[] = [];
            for (let track = trackMin - 1; track < trackMax; track++) {
                if (track in trackDict) {
                    throw new Error(`Track ${track} is in 2 groups: ${trackDict[track][0]}`);
                }
                trackDict[track] = [groupName, groupIndex];
                trackList.push(track);
            }
            result.push([groupName, fullWidthGroupName ?? null, trackList]);
        }
        let trackList = [...Array(trackCount).keys()].filter(x => !(x in trackDict));
        if (trackList.length > 0) {
            result.unshift([null, null, trackList]);
        }
        return result;
    }

    async getTrackTitle(track: number, wchar = false) {
        let wcharValue;
        if (wchar) {
            wcharValue = 3;
        } else {
            wcharValue = 2;
        }
        await this.changeDescriptorState(wchar ? Descriptor.audioUTOC4TD : Descriptor.audioUTOC1TD, DescriptorAction.openRead);
        const query = formatQuery('1806 022018%b %w 3000 0a00 ff00 00000000', wcharValue, track);
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1806 022018%? %?%? %?%? %?%? 1000 00%?0000 00%?000a %x');
        await this.changeDescriptorState(wchar ? Descriptor.audioUTOC4TD : Descriptor.audioUTOC1TD, DescriptorAction.close);
        return decodeFromSJIS(res[0] as Uint8Array);
    }

    async setDiscTitle(title: string, wchar = false) {
        let wcharValue;
        let currentTitle = await this._getDiscTitle(wchar);
        if (currentTitle === title) return; //Setting the same title causes problems with the LAM.

        let oldLen = getLengthAfterEncodingToSJIS(currentTitle);
        let newLength = getLengthAfterEncodingToSJIS(title);
        if (wchar) {
            wcharValue = 1;
            title = sanitizeFullWidthTitle(title);
        } else {
            wcharValue = 0;
            title = sanitizeHalfWidthTitle(title);
        }
        if (this.netMd.getVendor() == 0x04dd) {
            // Sharp disc rename (Issue #67 of webminidisc)
            await this.changeDescriptorState(Descriptor.audioUTOC1TD, DescriptorAction.openWrite);
        } else {
            await this.changeDescriptorState(Descriptor.discTitleTD, DescriptorAction.close);
            await this.changeDescriptorState(Descriptor.discTitleTD, DescriptorAction.openWrite);
        }
        const query = formatQuery('1807 02201801 00%b 3000 0a00 5000 %w 0000 %w %*', wcharValue, newLength, oldLen, encodeToSJIS(title));
        const reply = await this.sendQuery(query);
        scanQuery(reply, '1807 02201801 00%? 3000 0a00 5000 %?%? 0000 %?%?');
        if (this.netMd.getVendor() == 0x04dd) {
            await this.changeDescriptorState(Descriptor.audioUTOC1TD, DescriptorAction.close);
        } else {
            await this.changeDescriptorState(Descriptor.discTitleTD, DescriptorAction.close);
            await this.changeDescriptorState(Descriptor.discTitleTD, DescriptorAction.openRead);
            await this.changeDescriptorState(Descriptor.discTitleTD, DescriptorAction.close);
        }
    }

    async setTrackTitle(track: number, title: string, wchar = false) {
        let wcharValue;
        if (wchar) {
            wcharValue = 3;
            title = sanitizeFullWidthTitle(title);
        } else {
            wcharValue = 2;
            title = sanitizeHalfWidthTitle(title);
        }

        let oldLen: number;
        let newLen: number = getLengthAfterEncodingToSJIS(title);
        try {
            let currentTitle = await this.getTrackTitle(track, wchar);
            if (title === currentTitle) return;
            oldLen = getLengthAfterEncodingToSJIS(currentTitle);
        } catch (err) {
            if (err instanceof NetMDRejected) {
                oldLen = 0;
            } else {
                throw err;
            }
        }

        await this.changeDescriptorState(wchar ? Descriptor.audioUTOC4TD : Descriptor.audioUTOC1TD, DescriptorAction.openWrite);
        const query = formatQuery('1807 022018%b %w 3000 0a00 5000 %w 0000 %w %*', wcharValue, track, newLen, oldLen, encodeToSJIS(title));
        const reply = await this.sendQuery(query);
        scanQuery(reply, '1807 022018%? %?%? 3000 0a00 5000 %?%? 0000 %?%?');
        await this.changeDescriptorState(wchar ? Descriptor.audioUTOC4TD : Descriptor.audioUTOC1TD, DescriptorAction.close);
    }

    async eraseTrack(track: number) {
        const query = formatQuery('1840 ff01 00 201001 %w', track);
        const reply = await this.sendQuery(query);
        // scanQuery(reply, '1840 0001 00 201001 %?%?');
    }

    async moveTrack(source: number, dest: number) {
        const query = formatQuery('1843 ff00 00 201001 %w 201001 %w', source, dest);
        const reply = await this.sendQuery(query);
        // scanQuery(reply, '1843 0000 00 201001 00 %?%? 201001 %?%?');
    }

    async _getTrackInfo(track: number, p1: number, p2: number) {
        await this.changeDescriptorState(Descriptor.audioContentsTD, DescriptorAction.openRead);
        const query = formatQuery('1806 02201001 %w %w %w ff00 00000000', track, p1, p2);
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1806 02201001 %?%? %?%? %?%? 1000 00%?0000 %x');
        await this.changeDescriptorState(Descriptor.audioContentsTD, DescriptorAction.close);
        return String.fromCharCode(...(res[0] as Uint8Array));
    }

    async getTrackLength(track: number) {
        let rawValue = await this._getTrackInfo(track, 0x3000, 0x0100);
        let result = scanQuery(stringToCharCodeArray(rawValue), '0001 0006 0000 %B %B %B %B');

        return result as number[];
    }

    async getTrackEncoding(track: number) {
        let rawValue = await this._getTrackInfo(track, 0x3080, 0x0700);
        let result = scanQuery(stringToCharCodeArray(rawValue), '8007 0004 0110 %b %b');
        return result.map(i => JSBI.toNumber(i as JSBI));
    }

    async getTrackFlags(track: number) {
        await this.changeDescriptorState(Descriptor.audioContentsTD, DescriptorAction.openRead);
        const query = formatQuery('1806 01201001 %w ff00 00010008', track);
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1806 01201001 %?%? 10 00 00010008 %b')[0] as JSBI;
        await this.changeDescriptorState(Descriptor.audioContentsTD, DescriptorAction.close);
        return JSBI.toNumber(res);
    }

    async getDiscCapacity() {
        await this.changeDescriptorState(Descriptor.rootTD, DescriptorAction.openRead);
        const query = formatQuery('1806 02101000 3080 0300 ff00 00000000');
        const reply = await this.sendQuery(query);
        let result: number[][] = [];
        // 8003 changed to %?03 - Panasonic returns 0803 instead. This byte's meaning is unknown
        let res = scanQuery(
            reply,
            '1806 02101000 3080 0300 1000 001d0000 001b %?03 0017 8000 0005 %W %B %B %B 0005 %W %B %B %B 0005 %W %B %B %B'
        );                                                          //25^
        for (let i = 0; i < 3; i++) {
            let tmp: number[] = res.splice(0, 4) as number[];
            result.push(tmp);
        }
        await this.changeDescriptorState(Descriptor.rootTD, DescriptorAction.close);
        return result;
    }

    async getRecordingParameters() {
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.openRead);
        const query = formatQuery('1809 8001 0330 8801 0030 8805 0030 8807 00 ff00 00000000');
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1809 8001 0330 8801 0030 8805 0030 8807 00 1000 000e0000 000c 8805 0008 80e0 0110 %b %b 4000');
        await this.changeDescriptorState(Descriptor.operatingStatusBlock, DescriptorAction.close);
        return res.map(i => JSBI.toNumber(i as JSBI));
    }

    async saveTrackToArray(track: number, callback?: (length: number, read: number) => void): Promise<[DiscFormat, number, Uint8Array]> {
        // This can only be executed on an MZ-RH1 / M200
        const query = formatQuery('1800 080046 f003010330 ff00 1001 %w', track + 1);
        const reply = await this.sendQuery(query, false, true);
        const [frames, codec, length] = scanQuery(reply, '1800 080046 f0030103 300000 1001 %w %b %d');
        const result = await this.netMd.readBulk(length as number, 0x10000, callback);
        scanQuery(await this.readReply(), '1800 080046 f003010330 0000 1001 %?%? %?%?'); //The last byte is some kind of error counter.
        await sleep(500);

        let format: DiscFormat = ((codec as number) & 0x06) as DiscFormat;

        return [format, frames as number, result];
    }

    async disableNewTrackProtection(val: number) {
        const query = formatQuery('1800 080046 f0030103 2b ff %w', val);
        const reply = await this.sendQuery(query);
        scanQuery(reply, '1800 080046 f0030103 2b 00 %?%?');
    }

    async enterSecureSession() {
        const query = formatQuery('1800 080046 f0030103 80 ff');
        const reply = await this.sendQuery(query);
        return scanQuery(reply, '1800 080046 f0030103 80 00');
    }

    async leaveSecureSession() {
        const query = formatQuery('1800 080046 f0030103 81 ff');
        const reply = await this.sendQuery(query);
        return scanQuery(reply, '1800 080046 f0030103 81 00');
    }

    async getLeafID() {
        const query = formatQuery('1800 080046 f0030103 11 ff');
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1800 080046 f0030103 11 00 %*');
        return res[0] as Uint8Array;
    }

    async sendKeyData(ekbid: JSBI, keychain: Uint8Array[], depth: number, ekbsignature: Uint8Array) {
        const chainlen = keychain.length;
        const databytes = 16 + 16 * chainlen + 24;
        for (let key of keychain) {
            if (key.length !== 16) {
                throw new Error(`Each key in the chain needs to have 16 bytes; this one has ${key.length}`);
            }
        }
        if (depth < 1 || depth > 63) {
            throw new Error('Supplied depth is invalid');
        }
        if (ekbsignature.length !== 24) {
            throw new Error('Supplied EKB signature length wrong');
        }
        let keychains = concatUint8Arrays(...keychain);
        const query = formatQuery(
            '1800 080046 f0030103 12 ff %w 0000 %w %d %d %d 00000000 %* %*',
            databytes,
            databytes,
            chainlen,
            depth,
            ekbid,
            keychains,
            ekbsignature
        );
        const reply = await this.sendQuery(query);
        return scanQuery(reply, '1800 080046 f0030103 12 01 %?%? %?%?%?%?');
    }

    async sessionKeyExchange(hostnonce: Uint8Array) {
        if (hostnonce.length !== 8) {
            throw new Error('Supplied host nonce length wrong');
        }
        const query = formatQuery('1800 080046 f0030103 20 ff 000000 %*', hostnonce);
        const reply = await this.sendQuery(query);
        return scanQuery(reply, '1800 080046 f0030103 20 %? 000000 %#')[0] as Uint8Array; // '20 00' => '20 %?' - Fix for Panasonic SJ-MR270
    }

    async sessionKeyForget() {
        const query = formatQuery('1800 080046 f0030103 21 ff 000000');
        const reply = await this.sendQuery(query);
        return scanQuery(reply, '1800 080046 f0030103 21 00 000000');
    }

    async setupDownload(contentid: Uint8Array, keyenckey: Uint8Array, hexSessionKey: string) {
        if (contentid.length !== 20) {
            throw new Error('Supplied Content ID length wrong');
        }
        if (keyenckey.length !== 8) {
            throw new Error('Supplied Key Encryption Key length wrong');
        }
        if (hexSessionKey.length !== 16) {
            throw new Error('Supplied Session Key length wrong');
        }

        let message = concatUint8Arrays(new Uint8Array([1, 1, 1, 1]), contentid, keyenckey);
        const encryptedarg = Crypto.DES.encrypt(Crypto.lib.WordArray.create(message), Crypto.enc.Hex.parse(hexSessionKey), {
            mode: Crypto.mode.CBC,
            padding: Crypto.pad.NoPadding,
            iv: Crypto.enc.Hex.parse('0000000000000000'),
        });

        const query = formatQuery('1800 080046 f0030103 22 ff 0000 %*', wordArrayToByteArray(encryptedarg.ciphertext));
        // const query = formatQuery('1800 080046 f0030103 22 ff 0000' + Crypto.enc.Hex.stringify(encryptedarg.ciphertext));
        const reply = await this.sendQuery(query);
        return scanQuery(reply, '1800 080046 f0030103 22 00 0000');
    }

    async commitTrack(tracknum: number, hexSessionKey: string) {
        if (hexSessionKey.length !== 16) {
            throw new Error('Supplied Session Key length wrong');
        }
        const authentication = Crypto.DES.encrypt(Crypto.enc.Hex.parse('0000000000000000'), Crypto.enc.Hex.parse(hexSessionKey), {
            mode: Crypto.mode.ECB,
            padding: Crypto.pad.NoPadding,
        });


        const query = formatQuery('1800 080046 f0030103 48 ff 00 1001 %w %*', tracknum, wordArrayToByteArray(authentication.ciphertext));
        const reply = await this.sendQuery(query);
        const result = scanQuery(reply, '1800 080046 f0030103 48 00 00 1001 %?%?');

        return result;
    }

    async sendTrack(
        wireformat: number,
        discformat: number,
        frames: number,
        pktSize: number,
        packets: AsyncIterable<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array }>,
        hexSessionKey: string,
        progressCallback?: (progress: { writtenBytes: number; totalBytes: number }) => void
    ) {
        if (hexSessionKey.length !== 16) {
            throw new Error('Supplied Session Key length wrong');
        }

        // The sharps are slow...
        await sleep(200);

        const totalBytes = pktSize + 24; //framesizedict[wireformat] * frames + pktcount * 24;

        const query = formatQuery('1800 080046 f0030103 28 ff 000100 1001 ffff 00 %b %b %d %d', wireformat, discformat, frames, totalBytes);
        let reply = await this.sendQuery(query, false, true); // Accepts interim response
        scanQuery(reply, '1800 080046 f0030103 28 00 000100 1001 %?%? 00 %*');

        // The sharps are slow...
        await sleep(200);

        const swapNeeded = !isBigEndian();
        let packetCount = 0;
        let writtenBytes = 0;
        for await (const { key, iv, data } of packets) {
            progressCallback && progressCallback({ totalBytes, writtenBytes });
            let binpack: Uint8Array;
            if (packetCount === 0) {
                let packedLength = new Uint8Array(new Uint32Array([pktSize]).buffer);
                if (swapNeeded) {
                    packedLength.reverse();
                }
                binpack = concatUint8Arrays(new Uint8Array([0, 0, 0, 0]), packedLength, key, iv, data);
            } else {
                binpack = data;
            }
            await this.netMd.writeBulk(binpack);
            packetCount += 1;
            writtenBytes += data.length;
        }
        progressCallback && progressCallback({ totalBytes, writtenBytes });

        reply = await this.readReply();
        await this.netMd.getReplyLength();

        const res = scanQuery(reply, '1800 080046 f0030103 28 00 000100 1001 %w 00 %?%? %?%?%?%? %?%?%?%? %*');

        const replydata = Crypto.DES.decrypt(
            Crypto.lib.WordArray.create(res[1] as Uint8Array) as any,
            Crypto.enc.Hex.parse(hexSessionKey),
            {
                mode: Crypto.mode.CBC,
                iv: Crypto.enc.Hex.parse('0000000000000000'),
            }
        ).toString(Crypto.enc.Utf8);

        return [JSBI.toNumber(res[0] as JSBI), replydata.substring(0, 8), replydata.substring(12, 32)] as [number, string, string];
    }

    async getTrackUUID(track: number) {
        const query = formatQuery('1800 080046 f0030103 23 ff 1001 %w', track);
        const reply = await this.sendQuery(query);
        let res = scanQuery(reply, '1800 080046 f0030103 23 00 1001 %?%? %*');
        return String.fromCharCode(...(res[0] as Uint8Array));
    }

    async terminate() {
        const query = formatQuery('1800 080046 f0030103 2a ff00');
        await this.sendQuery(query);
    }
}

export function retailmac(key: Uint8Array, value: Uint8Array, iv: Uint8Array = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])) {
    let subkeyA = key.subarray(0, 8);
    let beginning = value.subarray(0, value.length - 8);
    let end = value.subarray(value.length - 8, value.length);

    let step1 = Crypto.DES.encrypt(Crypto.lib.WordArray.create(beginning) as any, Crypto.lib.WordArray.create(subkeyA) as any, {
        mode: Crypto.mode.CBC,
        iv: Crypto.lib.WordArray.create(iv) as any,
    });

    let iv2 = Crypto.enc.Hex.stringify(step1.ciphertext);
    iv2 = iv2.substring(0, iv2.length - 16); // last 8 byte

    let step2 = Crypto.TripleDES.encrypt(Crypto.lib.WordArray.create(end) as any, Crypto.lib.WordArray.create(key) as any, {
        mode: Crypto.mode.CBC,
        iv: Crypto.enc.Hex.parse(iv2),
    });

    return Crypto.enc.Hex.stringify(step2.ciphertext).substring(0, 16);
}

const discforwire: { [k: number]: number } = {
    [Wireformat.pcm]: DiscFormat.spStereo,
    [Wireformat.lp2]: DiscFormat.lp2,
    [Wireformat.l105kbps]: DiscFormat.lp2,
    [Wireformat.lp4]: DiscFormat.lp4,
};


export class MDTrack {
    constructor(
        public title: string,
        public format: Wireformat,
        public data: ArrayBuffer,
        public chunkSize: number,
        public fullWidthTitle?: string,
        public encryptPacketsIterator?: (params: {
            kek: Uint8Array;
            frameSize: number;
            data: ArrayBuffer;
            chunkSize: number;
        }) => AsyncIterableIterator<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array }>
    ) {}

    getFullWidthTitle() {
        return this.fullWidthTitle;
    }

    getTitle() {
        return this.title;
    }

    getDataFormat() {
        return this.format;
    }

    getFrameCount() {
        return this.getTotalSize() / this.getFrameSize();
    }

    getFrameSize() {
        return FrameSize[this.format];
    }

    getChunkSize() {
        return this.chunkSize;
    }

    getTotalSize() {
        const frameSize = this.getFrameSize();
        let len = this.data.byteLength;
        if (len % frameSize !== 0) {
            len = len + (frameSize - (len % frameSize));
        }
        return len;
    }

    getContentID() {
        // prettier-ignore
        return new Uint8Array([
            0x01, 0x0f, 0x50, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x48,
            0xa2, 0x8d, 0x3e, 0x1a, 0x3b, 0x0c, 0x44, 0xaf, 0x2f, 0xa0,
        ]);
    }

    getKEK() {
        return new Uint8Array([0x14, 0xe3, 0x83, 0x4e, 0xe2, 0xd3, 0xcc, 0xa5]);
    }

    getPackets(): [[Uint8Array, Uint8Array, Uint8Array]] {
        // Deprecated. Use getPacketIterator
        const datakey = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
        const firstiv = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

        const datakeyWA = Crypto.lib.WordArray.create(datakey) as any;
        const kekWA = Crypto.lib.WordArray.create(this.getKEK()) as any;

        const key = Crypto.DES.encrypt(datakeyWA, kekWA, { mode: Crypto.mode.ECB });

        const firstivWA = Crypto.lib.WordArray.create(firstiv) as any;
        const dataWA = Crypto.lib.WordArray.create(new Uint8Array(this.data)) as any;

        let encrypted = Crypto.DES.encrypt(dataWA, key.ciphertext, {
            mode: Crypto.mode.CBC,
            iv: firstivWA,
        });

        let encryptedData = wordArrayToByteArray(encrypted.ciphertext);
        encryptedData = encryptedData.subarray(0, this.data.byteLength); // CAVEAT: don't know why, but python Crypto returns 8 bytes less that js Crypto
        return [[datakey, firstiv, encryptedData]];
    }

    getPacketWorkerIterator(): AsyncIterableIterator<{ key: Uint8Array; iv: Uint8Array; data: Uint8Array }> {
        return this.encryptPacketsIterator!({
            kek: this.getKEK(),
            data: this.data,
            frameSize: this.getFrameSize(),
            chunkSize: this.chunkSize,
        });
    }

    async *getPacketIterator(): AsyncIterableIterator<[Uint8Array, Uint8Array, Uint8Array]> {
        let iv = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
        let ivWA = Crypto.lib.WordArray.create(iv) as any;

        const kekWA = Crypto.lib.WordArray.create(this.getKEK()) as any;
        const rawKeyWA = Crypto.lib.WordArray.random(8);
        const keyDec = Crypto.DES.decrypt(
            {
                ciphertext: rawKeyWA,
            } as any,
            kekWA,
            { mode: Crypto.mode.ECB, padding: Crypto.pad.Pkcs7 }
        );
        (keyDec as any).sigBytes = 8;
        const key = wordArrayToByteArray(keyDec);

        const defaultChunkSize = 0x00100000;
        let packetCount = 0;
        let chunkSize = 0;

        let uint8DataArray = new Uint8Array(this.data);

        const frameSize = this.getFrameSize();
        if (uint8DataArray.length % frameSize !== 0) {
            // Pad to frame size if needed
            let padding = frameSize - (uint8DataArray.length % frameSize);
            uint8DataArray = concatUint8Arrays(uint8DataArray, new Uint8Array(Array(padding).fill(0)));
        }

        let offset = 0;
        while (offset < uint8DataArray.length) {
            if (packetCount > 0) {
                chunkSize = defaultChunkSize;
            } else {
                chunkSize = defaultChunkSize - 24;
            }

            chunkSize = Math.min(chunkSize, uint8DataArray.length - offset);

            const dataChunk = uint8DataArray.subarray(offset, offset + chunkSize);
            const dataChunkWA = Crypto.lib.WordArray.create(dataChunk) as any;

            let encryptedChunk = Crypto.DES.encrypt(dataChunkWA, rawKeyWA as any, {
                mode: Crypto.mode.CBC,
                iv: ivWA,
            });

            let encryptedDataChunk = wordArrayToByteArray(encryptedChunk.ciphertext);
            encryptedDataChunk = encryptedDataChunk.subarray(0, chunkSize); //encryptedDataChunk.length - 8

            yield [key, iv, encryptedDataChunk];

            // Next iv
            ivWA = Crypto.lib.WordArray.create(encryptedDataChunk.subarray(encryptedDataChunk.length - 8, encryptedDataChunk.length));
            iv = wordArrayToByteArray(ivWA);

            offset = offset + chunkSize;
            packetCount += 1;
        }
    }
}

export class MDSession {
    private ekbobject?: EKB;
    constructor(private md: NetMDInterface, private hexSessionKey?: string) {}

    async init() {
        await this.md.enterSecureSession();
        const leafID = await this.md.getLeafID();
        this.ekbobject = getEKBForDevice(leafID, this.md.netMd.getVendor(), this.md.netMd.getProduct());
        const [chain, depth, sig] = this.ekbobject.getEKBDataForLeafId();
        await this.md.sendKeyData(JSBI.BigInt(this.ekbobject.getEKBID()), chain, depth, sig);
        let hostnonce = new Uint8Array(
            Array(8)
                .fill(0)
                .map(_ => Math.round(Math.random() * 255))
        );
        let devnonce = await this.md.sessionKeyExchange(hostnonce);
        let nonce = concatUint8Arrays(hostnonce, devnonce);
        this.hexSessionKey = retailmac(this.ekbobject.getRootKey(), nonce);
    }

    async downloadTrack(trk: MDTrack, progressCallback?: (progress: { writtenBytes: number; totalBytes: number }) => void, discFormat = discforwire[trk.getDataFormat()]) {
        if (!this.hexSessionKey) {
            throw new Error(`Call init first!`);
        }

        await this.md.setupDownload(trk.getContentID(), trk.getKEK(), this.hexSessionKey);
        let dataFormat = trk.getDataFormat();
        let [track, uuid, ccid] = await this.md.sendTrack(
            dataFormat,
            discFormat,
            trk.getFrameCount(),
            trk.getTotalSize(),
            trk.getPacketWorkerIterator(),
            this.hexSessionKey!,
            progressCallback
        );
        await this.md.setTrackTitle(track, trk.title);
        if (trk.fullWidthTitle) {
            await this.md.setTrackTitle(track, trk.fullWidthTitle, true);
        }
        await this.md.commitTrack(track, this.hexSessionKey);
        return [track, uuid, ccid];
    }

    async close() {
        if (this.hexSessionKey !== undefined) {
            try {
                await this.md.sessionKeyForget();
            } catch (err) {
                // Nothing to do
            }
            this.hexSessionKey = undefined;
        }
        await this.md.leaveSecureSession();
    }
}
