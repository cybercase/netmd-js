## JS library to access NetMD MiniDisc devices

This is a port to TypeScript of the [linux-minidisc](https://github.com/glaubitz/linux-minidisc) project.

It works either in node and every browser supporting the [WebUSB](https://wicg.github.io/webusb/) standard.

### How to Install CLI (netmdcli)
```
npm install netmd-js -g
```

### How to build
```
npm install
npm run build
```

### How to upload music
There's a minimal CLI called `netmdcli` that I've written for testing, but the primary purpose of this library is to serve the [Web MiniDisc](https://github.com/cybercase/webminidisc) project.

If you want to upload music to your device using the cli keep in mind that it won't parse your audio file container, but it works only with raw audio data.

[ffmpeg](https://www.ffmpeg.org/) will do the trick of extracting the raw data from your audio files for *SP* uploads. If you want to use *LP2* or *LP4* you'll also need [atracdenc](https://github.com/dcherednik/atracdenc).

##### SP
```
ffmpeg -i youraudiofile -f s16be rawaudiodata.raw  # outputs raw audio data suitable for SP uploads
```

##### LP2
```
ffmpeg -i youraudiofile youraudiofile.wav # 44100 16bit wav input file suitable for atracdenc
atracdenc -e atrac3 -i youraudiofile.wav -o youraudiofile.oma --bitrate 128
dd bs=96 skip=1 if=youraudiofile.oma of=rawaudiodata.raw # removes OMA file header
```

##### LP4
```
ffmpeg -i youraudiofile youraudiofile.wav # 44100 16bit wav input file suitable for atracdenc
atracdenc -e atrac3 -i youraudiofile.wav -o youraudiofile.oma --bitrate 64
dd bs=96 skip=1 if=youraudiofile.oma of=rawaudiodata.raw # removes OMA file header
```

Then just run
```
netmdcli upload rawaudiodata.raw -f sp|lp2|lp4
```

### How Contribute
Every contribute is welcome but, please, reach out to me before opening any PR.

### Acknowledgments
This library has been made possible by the amazing work done from the [linux-minidisc](https://github.com/glaubitz/linux-minidisc) project.
