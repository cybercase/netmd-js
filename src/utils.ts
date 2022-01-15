/* A bunch of utils. Some might be unused */
import { Buffer } from 'buffer';
import jconv from 'jconv';
import { Disc, DiscFormat, Track } from '.';

export async function sleep(msec: number) {
    await new Promise(resolve => setTimeout(resolve, msec));
}

export function withTimeout<T>(timeoutInMs: number, cb: () => T): Promise<T> {
    return new Promise(async (resolve, reject) => {
        // Start the timer
        let timer = setTimeout(() => {
            reject(new Error(`Operation timed out`));
        }, timeoutInMs);

        let result = await cb();

        clearTimeout(timer);

        resolve(result);
    });
}

export function assert(condition: boolean, message?: string) {
    if (condition) {
        return;
    }
    message = message || 'no message provided';
    throw new Error(`Assertion failed: ${message}`);
}

export function assertBigInt(value: unknown, message?: string): bigint {
    if (typeof value === 'bigint') {
        return value as bigint;
    }
    throw assert(false, `Expected BigInt type - ${message}`);
}

export function assertNumber(value: unknown, message?: string): number {
    if (typeof value === 'number') {
        return value as number;
    }
    throw assert(false, `Expected number type - ${message}`);
}

export function assertString(value: unknown, message?: string): string {
    if (typeof value === 'string') {
        return value as string;
    }
    throw assert(false, `Expected string type - ${message}`);
}

export function assertUint8Array(value: unknown, message?: string): Uint8Array {
    if (value instanceof Uint8Array) {
        return value as Uint8Array;
    }
    throw assert(false, `Expected Uint8Array type - ${message}`);
}

export function stringToCharCodeArray(str: string) {
    let result = new Array(str.length);
    for (let i = 0; i < str.length; i++) {
        result[i] = str.charCodeAt(i);
    }
    return result;
}

// compare ArrayBuffers
export function arrayBuffersAreEqual(a: ArrayBuffer, b: ArrayBuffer) {
    return dataViewsAreEqual(new DataView(a), new DataView(b));
}

// compare DataViews
export function dataViewsAreEqual(a: DataView, b: DataView) {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
        if (a.getUint8(i) !== b.getUint8(i)) return false;
    }
    return true;
}

// Thanks to https://gist.github.com/TooTallNate/4750953
export function isBigEndian() {
    return new Uint8Array(new Uint32Array([0x12345678]).buffer)[0] === 0x12;
}

export function hexEncode(str: string) {
    let hex;
    let result = '';
    for (let i = 0; i < str.length; i++) {
        hex = str.charCodeAt(i).toString(16);
        result += ('0' + hex).slice(-2);
    }

    return result;
}

export function arrayBufferToBinaryString(ab: ArrayBuffer) {
    let src = new Uint8Array(ab);
    return uint8arrayToBinaryString(src);
}

export function uint8arrayToBinaryString(u8a: Uint8Array) {
    let dst = Array(u8a.length);
    u8a.forEach((c, i) => (dst[i] = String.fromCharCode(c)));
    return dst.join('');
}

export function concatUint8Arrays(...args: Uint8Array[]) {
    let totalLength = 0;
    for (let a of args) {
        totalLength += a.length;
    }

    let res = new Uint8Array(totalLength);

    let offset = 0;
    for (let a of args) {
        res.set(a, offset);
        offset += a.length;
    }
    return res;
}

export function concatArrayBuffers(buffer1: ArrayBuffer, buffer2: ArrayBuffer) {
    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
}

// Thanks to: https://gist.github.com/artjomb/7ef1ee574a411ba0dd1933c1ef4690d1
function wordToByteArray(word: number, length: number, littleEndian = false) {
    let ba = [],
        xFF = 0xff;
    let actualLength = length;
    if (littleEndian) {
        length = 4;
    }
    if (length > 0) ba.push(word >>> 24);
    if (length > 1) ba.push((word >>> 16) & xFF);
    if (length > 2) ba.push((word >>> 8) & xFF);
    if (length > 3) ba.push(word & xFF);
    if (littleEndian) {
        ba = ba.splice(4 - actualLength).reverse();
    }
    return ba;
}

export function wordArrayToByteArray(wordArray: any, length: number = wordArray.sigBytes) {
    let res = new Uint8Array(length);
    let bytes;
    let i = 0;
    let offset = 0;
    while (length > 0) {
        bytes = wordToByteArray(wordArray.words[i], Math.min(4, length));
        res.set(bytes, offset);
        length -= bytes.length;
        offset += bytes.length;
        i++;
    }
    return res;
}

export function timeToFrames(time: number[]) {
    assert(time.length === 4);
    return ((time[0] * 60 + time[1]) * 60 + time[2]) * 512 + time[3];
}

export function pad(str: string | number, pad: string) {
    return (pad + str).slice(-pad.length);
}

export function formatTimeFromFrames(value: number, frames: boolean = true) {
    let f = value % 512;
    value = (value - f) / 512; // sec

    let s = value % 60;
    value = (value - s) / 60; // min

    let m = value % 60;
    value = (value - m) / 60; // hour

    let h = value;

    return `${pad(h, '00')}:${pad(m, '00')}:${pad(s, '00')}` + (frames ? `+${pad(f, '000')}` : ``);
}

export function halfWidthToFullWidthRange(range: string) {
    const mappings: { [key: string]: string } = {
        '0': '０',
        '1': '１',
        '2': '２',
        '3': '３',
        '4': '４',
        '5': '５',
        '6': '６',
        '7': '７',
        '8': '８',
        '9': '９',
        '-': '－',
        '/': '／',
        ';': '；',
    };
    return range
        .split('')
        .map(n => mappings[n] ?? '')
        .join('');
}

export function sanitizeTrackTitle(title: string) {
    return encodeURIComponent(title);
}

export function encodeToSJIS(utf8String: string): Uint8Array {
    return jconv.encode(utf8String, 'SJIS');
}

export function decodeFromSJIS(sjisBuffer: Uint8Array) {
    return jconv.decode(Buffer.from(sjisBuffer), 'SJIS');
}

export function getLengthAfterEncodingToSJIS(utf8String: string) {
    return encodeToSJIS(utf8String).length;
}

export function getHalfWidthTitleLength(title: string) {
    // Some characters are written as 2 bytes
    // prettier-ignore
    // '\u309C': -1, '\uFF9F': -1, '\u309B': -1, '\uFF9E': -1 but when they become part of a multi byte character, it will sum up to 0
    const multiByteChars: { [key: string]: number } = { "ガ": 1, "ギ": 1, "グ": 1, "ゲ": 1, "ゴ": 1, "ザ": 1, "ジ": 1, "ズ": 1, "ゼ": 1, "ゾ": 1, "ダ": 1, "ヂ": 1, "ヅ": 1, "デ": 1, "ド": 1, "バ": 1, "パ": 1, "ビ": 1, "ピ": 1, "ブ": 1, "プ": 1, "ベ": 1, "ペ": 1, "ボ": 1, "ポ": 1, "ヮ": 1, "ヰ": 1, "ヱ": 1, "ヵ": 1, "ヶ": 1, "ヴ": 1, "ヽ": 1, "ヾ": 1, "が": 1, "ぎ": 1, "ぐ": 1, "げ": 1, "ご": 1, "ざ": 1, "じ": 1, "ず": 1, "ぜ": 1, "ぞ": 1, "だ": 1, "ぢ": 1, "づ": 1, "で": 1, "ど": 1, "ば": 1, "ぱ": 1, "び": 1, "ぴ": 1, "ぶ": 1, "ぷ": 1, "べ": 1, "ぺ": 1, "ぼ": 1, "ぽ": 1, "ゎ": 1, "ゐ": 1, "ゑ": 1, "ゕ": 1, "ゖ": 1, "ゔ": 1, "ゝ": 1, "ゞ": 1 };
    return (
        title.length +
        title
            .split('')
            .map(n => multiByteChars[n] ?? 0)
            .reduce((a, b) => a + b, 0)
    );
}

export function sanitizeHalfWidthTitle(title: string) {
    enum CharType {
        normal,
        dakuten,
        handakuten,
    }

    const handakutenPossible = 'はひふへほハヒフヘホ'.split('');
    const dakutenPossible = 'かきくけこさしすせそたちつてとカキクケコサシスセソタチツテト'.split('').concat(handakutenPossible);

    //'Flatten' all the characters followed by the (han)dakuten character into one
    let dakutenFix = [];
    let type = CharType.normal;
    for (const char of sanitizeFullWidthTitle(title, true)
        .split('')
        .reverse()) {
        //This only works for full-width kana. It will get converted to half-width later anyway...
        switch (type) {
            case CharType.dakuten:
                if (dakutenPossible.includes(char)) {
                    dakutenFix.push(String.fromCharCode(char.charCodeAt(0) + 1));
                    type = CharType.normal;
                    break;
                } //Else fall through
            case CharType.handakuten:
                if (handakutenPossible.includes(char)) {
                    dakutenFix.push(String.fromCharCode(char.charCodeAt(0) + 2));
                    type = CharType.normal;
                    break;
                } //Else fall through
            case CharType.normal:
                switch (char) {
                    case '\u309B':
                    case '\u3099':
                    case '\uFF9E':
                        type = CharType.dakuten;
                        break;
                    case '\u309C':
                    case '\u309A':
                    case '\uFF9F':
                        type = CharType.handakuten;
                        break;
                    default:
                        type = CharType.normal;
                        dakutenFix.push(char);
                        break;
                }
                break;
        }
    }

    title = dakutenFix.reverse().join('');
    // prettier-ignore
    const mappings: { [key: string]: string } = { '－': '-', 'ｰ': '-', 'ァ': 'ｧ', 'ア': 'ｱ', 'ィ': 'ｨ', 'イ': 'ｲ', 'ゥ': 'ｩ', 'ウ': 'ｳ', 'ェ': 'ｪ', 'エ': 'ｴ', 'ォ': 'ｫ', 'オ': 'ｵ', 'カ': 'ｶ', 'ガ': 'ｶﾞ', 'キ': 'ｷ', 'ギ': 'ｷﾞ', 'ク': 'ｸ', 'グ': 'ｸﾞ', 'ケ': 'ｹ', 'ゲ': 'ｹﾞ', 'コ': 'ｺ', 'ゴ': 'ｺﾞ', 'サ': 'ｻ', 'ザ': 'ｻﾞ', 'シ': 'ｼ', 'ジ': 'ｼﾞ', 'ス': 'ｽ', 'ズ': 'ｽﾞ', 'セ': 'ｾ', 'ゼ': 'ｾﾞ', 'ソ': 'ｿ', 'ゾ': 'ｿﾞ', 'タ': 'ﾀ', 'ダ': 'ﾀﾞ', 'チ': 'ﾁ', 'ヂ': 'ﾁﾞ', 'ッ': 'ｯ', 'ツ': 'ﾂ', 'ヅ': 'ﾂﾞ', 'テ': 'ﾃ', 'デ': 'ﾃﾞ', 'ト': 'ﾄ', 'ド': 'ﾄﾞ', 'ナ': 'ﾅ', 'ニ': 'ﾆ', 'ヌ': 'ﾇ', 'ネ': 'ﾈ', 'ノ': 'ﾉ', 'ハ': 'ﾊ', 'バ': 'ﾊﾞ', 'パ': 'ﾊﾟ', 'ヒ': 'ﾋ', 'ビ': 'ﾋﾞ', 'ピ': 'ﾋﾟ', 'フ': 'ﾌ', 'ブ': 'ﾌﾞ', 'プ': 'ﾌﾟ', 'ヘ': 'ﾍ', 'ベ': 'ﾍﾞ', 'ペ': 'ﾍﾟ', 'ホ': 'ﾎ', 'ボ': 'ﾎﾞ', 'ポ': 'ﾎﾟ', 'マ': 'ﾏ', 'ミ': 'ﾐ', 'ム': 'ﾑ', 'メ': 'ﾒ', 'モ': 'ﾓ', 'ャ': 'ｬ', 'ヤ': 'ﾔ', 'ュ': 'ｭ', 'ユ': 'ﾕ', 'ョ': 'ｮ', 'ヨ': 'ﾖ', 'ラ': 'ﾗ', 'リ': 'ﾘ', 'ル': 'ﾙ', 'レ': 'ﾚ', 'ロ': 'ﾛ', 'ワ': 'ﾜ', 'ヲ': 'ｦ', 'ン': 'ﾝ', 'ー': '-', 'ヮ': 'ヮ', 'ヰ': 'ヰ', 'ヱ': 'ヱ', 'ヵ': 'ヵ', 'ヶ': 'ヶ', 'ヴ': 'ｳﾞ', 'ヽ': 'ヽ', 'ヾ': 'ヾ', '・': '･', '「': '｢', '」': '｣', '。': '｡', '、': '､', '！': '!', '＂': '"', '＃': '#', '＄': '$', '％': '%', '＆': '&', '＇': "'", '（': '(', '）': ')', '＊': '*', '＋': '+', '，': ',', '．': '.', '／': '/', '：': ':', '；': ';', '＜': '<', '＝': '=', '＞': '>', '？': '?', '＠': '@', 'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E', 'Ｆ': 'F', 'Ｇ': 'G', 'Ｈ': 'H', 'Ｉ': 'I', 'Ｊ': 'J', 'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O', 'Ｐ': 'P', 'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T', 'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X', 'Ｙ': 'Y', 'Ｚ': 'Z', '［': '[', '＼': '\\', '］': ']', '＾': '^', '＿': '_', '｀': '`', 'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g', 'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z', '｛': '{', '｜': '|', '｝': '}', '～': '~', '\u3000': ' ', '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9', 'ぁ': 'ｧ', 'あ': 'ｱ', 'ぃ': 'ｨ', 'い': 'ｲ', 'ぅ': 'ｩ', 'う': 'ｳ', 'ぇ': 'ｪ', 'え': 'ｴ', 'ぉ': 'ｫ', 'お': 'ｵ', 'か': 'ｶ', 'が': 'ｶﾞ', 'き': 'ｷ', 'ぎ': 'ｷﾞ', 'く': 'ｸ', 'ぐ': 'ｸﾞ', 'け': 'ｹ', 'げ': 'ｹﾞ', 'こ': 'ｺ', 'ご': 'ｺﾞ', 'さ': 'ｻ', 'ざ': 'ｻﾞ', 'し': 'ｼ', 'じ': 'ｼﾞ', 'す': 'ｽ', 'ず': 'ｽﾞ', 'せ': 'ｾ', 'ぜ': 'ｾﾞ', 'そ': 'ｿ', 'ぞ': 'ｿﾞ', 'た': 'ﾀ', 'だ': 'ﾀﾞ', 'ち': 'ﾁ', 'ぢ': 'ﾁﾞ', 'っ': 'ｯ', 'つ': 'ﾂ', 'づ': 'ﾂﾞ', 'て': 'ﾃ', 'で': 'ﾃﾞ', 'と': 'ﾄ', 'ど': 'ﾄﾞ', 'な': 'ﾅ', 'に': 'ﾆ', 'ぬ': 'ﾇ', 'ね': 'ﾈ', 'の': 'ﾉ', 'は': 'ﾊ', 'ば': 'ﾊﾞ', 'ぱ': 'ﾊﾟ', 'ひ': 'ﾋ', 'び': 'ﾋﾞ', 'ぴ': 'ﾋﾟ', 'ふ': 'ﾌ', 'ぶ': 'ﾌﾞ', 'ぷ': 'ﾌﾟ', 'へ': 'ﾍ', 'べ': 'ﾍﾞ', 'ぺ': 'ﾍﾟ', 'ほ': 'ﾎ', 'ぼ': 'ﾎﾞ', 'ぽ': 'ﾎﾟ', 'ま': 'ﾏ', 'み': 'ﾐ', 'む': 'ﾑ', 'め': 'ﾒ', 'も': 'ﾓ', 'ゃ': 'ｬ', 'や': 'ﾔ', 'ゅ': 'ｭ', 'ゆ': 'ﾕ', 'ょ': 'ｮ', 'よ': 'ﾖ', 'ら': 'ﾗ', 'り': 'ﾘ', 'る': 'ﾙ', 'れ': 'ﾚ', 'ろ': 'ﾛ', 'わ': 'ﾜ', 'を': 'ｦ', 'ん': 'ﾝ', 'ゎ': 'ヮ', 'ゐ': 'ヰ', 'ゑ': 'ヱ', 'ゕ': 'ヵ', 'ゖ': 'ヶ', 'ゔ': 'ｳﾞ', 'ゝ': 'ヽ', 'ゞ': 'ヾ' };
    const allowedHalfWidthKana: string[] = Object.values(mappings);
    function check(n: string) {
        if (mappings[n]) return mappings[n];
        if (n.charCodeAt(0) < 0x7f || allowedHalfWidthKana.includes(n)) return n;
        return null;
    }

    const newTitle = title
        .split('')
        .map(c => {
            return check(c) ?? check(c.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) ?? ' ';
        })
        .join('');
    // Check if the amount of characters is the same as the amount of encoded bytes (when accounting for dakuten). Otherwise the disc might end up corrupted
    const sjisEncoded = jconv.encode(newTitle, 'SJIS');
    if (sjisEncoded.length !== getHalfWidthTitleLength(title)) return aggressiveSanitizeTitle(title); //Fallback
    return newTitle;
}

export function sanitizeFullWidthTitle(title: string, justRemap: boolean = false) {
    // prettier-ignore
    const mappings: { [key: string]: string } = { '!': '！', '"': '＂', '#': '＃', '$': '＄', '%': '％', '&': '＆', "'": '＇', '(': '（', ')': '）', '*': '＊', '+': '＋', ',': '，', '-': '－', '.': '．', '/': '／', ':': '：', ';': '；', '<': '＜', '=': '＝', '>': '＞', '?': '？', '@': '＠', 'A': 'Ａ', 'B': 'Ｂ', 'C': 'Ｃ', 'D': 'Ｄ', 'E': 'Ｅ', 'F': 'Ｆ', 'G': 'Ｇ', 'H': 'Ｈ', 'I': 'Ｉ', 'J': 'Ｊ', 'K': 'Ｋ', 'L': 'Ｌ', 'M': 'Ｍ', 'N': 'Ｎ', 'O': 'Ｏ', 'P': 'Ｐ', 'Q': 'Ｑ', 'R': 'Ｒ', 'S': 'Ｓ', 'T': 'Ｔ', 'U': 'Ｕ', 'V': 'Ｖ', 'W': 'Ｗ', 'X': 'Ｘ', 'Y': 'Ｙ', 'Z': 'Ｚ', '[': '［', '\\': '＼', ']': '］', '^': '＾', '_': '＿', '`': '｀', 'a': 'ａ', 'b': 'ｂ', 'c': 'ｃ', 'd': 'ｄ', 'e': 'ｅ', 'f': 'ｆ', 'g': 'ｇ', 'h': 'ｈ', 'i': 'ｉ', 'j': 'ｊ', 'k': 'ｋ', 'l': 'ｌ', 'm': 'ｍ', 'n': 'ｎ', 'o': 'ｏ', 'p': 'ｐ', 'q': 'ｑ', 'r': 'ｒ', 's': 'ｓ', 't': 'ｔ', 'u': 'ｕ', 'v': 'ｖ', 'w': 'ｗ', 'x': 'ｘ', 'y': 'ｙ', 'z': 'ｚ', '{': '｛', '|': '｜', '}': '｝', '~': '～', ' ': '\u3000', '0': '０', '1': '１', '2': '２', '3': '３', '4': '４', '5': '５', '6': '６', '7': '７', '8': '８', '9': '９', 'ｧ': 'ァ', 'ｱ': 'ア', 'ｨ': 'ィ', 'ｲ': 'イ', 'ｩ': 'ゥ', 'ｳ': 'ウ', 'ｪ': 'ェ', 'ｴ': 'エ', 'ｫ': 'ォ', 'ｵ': 'オ', 'ｶ': 'カ', 'ｶﾞ': 'ガ', 'ｷ': 'キ', 'ｷﾞ': 'ギ', 'ｸ': 'ク', 'ｸﾞ': 'グ', 'ｹ': 'ケ', 'ｹﾞ': 'ゲ', 'ｺ': 'コ', 'ｺﾞ': 'ゴ', 'ｻ': 'サ', 'ｻﾞ': 'ザ', 'ｼ': 'シ', 'ｼﾞ': 'ジ', 'ｽ': 'ス', 'ｽﾞ': 'ズ', 'ｾ': 'セ', 'ｾﾞ': 'ゼ', 'ｿ': 'ソ', 'ｿﾞ': 'ゾ', 'ﾀ': 'タ', 'ﾀﾞ': 'ダ', 'ﾁ': 'チ', 'ﾁﾞ': 'ヂ', 'ｯ': 'ッ', 'ﾂ': 'ツ', 'ﾂﾞ': 'ヅ', 'ﾃ': 'テ', 'ﾃﾞ': 'デ', 'ﾄ': 'ト', 'ﾄﾞ': 'ド', 'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ', 'ﾊ': 'ハ', 'ﾊﾞ': 'バ', 'ﾊﾟ': 'パ', 'ﾋ': 'ヒ', 'ﾋﾞ': 'ビ', 'ﾋﾟ': 'ピ', 'ﾌ': 'フ', 'ﾌﾞ': 'ブ', 'ﾌﾟ': 'プ', 'ﾍ': 'ヘ', 'ﾍﾞ': 'ベ', 'ﾍﾟ': 'ペ', 'ﾎ': 'ホ', 'ﾎﾞ': 'ボ', 'ﾎﾟ': 'ポ', 'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ', 'ｬ': 'ャ', 'ﾔ': 'ヤ', 'ｭ': 'ュ', 'ﾕ': 'ユ', 'ｮ': 'ョ', 'ﾖ': 'ヨ', 'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ', 'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン', 'ｰ': 'ー', 'ヮ': 'ヮ', 'ヰ': 'ヰ', 'ヱ': 'ヱ', 'ヵ': 'ヵ', 'ヶ': 'ヶ', 'ｳﾞ': 'ヴ', 'ヽ': 'ヽ', 'ヾ': 'ヾ', '･': '・', '｢': '「', '｣': '」', '｡': '。', '､': '、' };

    const newTitle = title
        .split('')
        .map(n => mappings[n] ?? n)
        .join('');

    if (justRemap) return newTitle;

    const sjisEncoded = jconv.encode(newTitle, 'SJIS');
    if (jconv.decode(sjisEncoded, 'SJIS') !== newTitle) return aggressiveSanitizeTitle(title); // Fallback
    if (sjisEncoded.length !== title.length * 2) return aggressiveSanitizeTitle(title); // Fallback (every character in the full-width title is 2 bytes)
    return newTitle;
}

export function aggressiveSanitizeTitle(title: string) {
    return title.normalize('NFD').replace(/[^\x00-\x7F]/g, '');
}

export function createAeaHeader(name = '', channels = 2, soundgroups = 1, groupstart = 0, encrypted = 0, flags = [0, 0, 0, 0, 0, 0, 0, 0]) {
    const encodedName = Buffer.from(name);
    const header = concatUint8Arrays(
        new Uint8Array(wordToByteArray(2048, 4, true)),
        encodedName,
        new Uint8Array(256 - encodedName.length),
        new Uint8Array(wordToByteArray(soundgroups, 4, true)),
        new Uint8Array([channels, 0]),
        new Uint8Array(wordToByteArray(flags[0], 4, true)),
        new Uint8Array(wordToByteArray(flags[1], 4, true)),
        new Uint8Array(wordToByteArray(flags[2], 4, true)),
        new Uint8Array(wordToByteArray(flags[3], 4, true)),
        new Uint8Array(wordToByteArray(flags[4], 4, true)),
        new Uint8Array(wordToByteArray(flags[5], 4, true)),
        new Uint8Array(wordToByteArray(flags[6], 4, true)),
        new Uint8Array(wordToByteArray(flags[7], 4, true)),
        new Uint8Array(wordToByteArray(0, 4, true)),
        new Uint8Array(wordToByteArray(encrypted, 4, true)),
        new Uint8Array(wordToByteArray(groupstart, 4, true))
    );
    return concatUint8Arrays(header, new Uint8Array(2048 - header.length));
}

export function createWavHeader(format: DiscFormat, bytes: number) {
    let jointStereo, bytesPerFrame;
    switch (format) {
        case DiscFormat.lp2:
            bytesPerFrame = 192;
            jointStereo = 0;
            break;
        case DiscFormat.lp4:
            bytesPerFrame = 96;
            jointStereo = 1;
            break;
        default:
            throw new Error(`Cannot create WAV header for disc type ${DiscFormat[format]}`);
    }
    let bytesPerSecond = (bytesPerFrame * 44100) / 512;
    return concatUint8Arrays(
        Buffer.from('RIFF'),
        new Uint8Array(wordToByteArray(bytes + 60, 4, true)),
        Buffer.from('WAVEfmt '),
        new Uint8Array(wordToByteArray(32, 4, true)),
        new Uint8Array(wordToByteArray(0x270, 2, true)),
        new Uint8Array(wordToByteArray(2, 2, true)),
        new Uint8Array(wordToByteArray(44100, 4, true)),
        new Uint8Array(wordToByteArray(bytesPerSecond, 4, true)),
        new Uint8Array(wordToByteArray(bytesPerFrame * 2, 2, true)),
        new Uint8Array([0, 0]),

        new Uint8Array(wordToByteArray(14, 2, true)),
        new Uint8Array(wordToByteArray(1, 2, true)),
        new Uint8Array(wordToByteArray(bytesPerFrame, 4, true)),
        new Uint8Array(wordToByteArray(jointStereo, 2, true)),
        new Uint8Array(wordToByteArray(jointStereo, 2, true)),
        new Uint8Array(wordToByteArray(1, 2, true)),
        new Uint8Array(wordToByteArray(0, 2, true)),
        Buffer.from('data'),
        new Uint8Array(wordToByteArray(bytes, 4, true))
    );
}
