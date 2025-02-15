# 8bitworkshop

![example workflow](https://github.com/sehugg/8bitworkshop/actions/workflows/node.js.yml/badge.svg)


## Use Online

* Latest release: https://8bitworkshop.com/
* Dev build: https://8bitworkshop.com/dev/

## Install Locally

To build the 8bitworkshop IDE:

```sh
git submodule init
git submodule update
npm i
npm run build
```

### Start Server

Start a web server on http://localhost:8000/ while TypeScript compiles in the background:

```sh
make tsweb
```

### Run Tests

```sh
npm test
```

Note: Github tests may fail due to lack of permissions.

## License

Copyright © 2016-2021 [Steven Hugg](https://github.com/sehugg).

This project is [GPL-3.0](https://github.com/sehugg/8bitworkshop/blob/master/LICENSE) licensed.

Dependencies retain their original licenses.

All included code samples (all files under the presets/ directory) are licensed under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/)
unless otherwise licensed.

## Dependencies

The IDE uses custom forks for many of these, found at https://github.com/sehugg?tab=repositories

### Emulators

* https://javatari.org/
* https://jsnes.org/
* https://www.mamedev.org/
* https://github.com/floooh/chips
* https://github.com/DrGoldfire/Z80.js
* http://www.twitchasylum.com/jsvecx/
* https://github.com/curiousdannii/ifvms.js/

### Compilers

* https://cc65.github.io/
* http://sdcc.sourceforge.net/
* http://perso.b2b2c.ca/~sarrazip/dev/cmoc.html
* https://github.com/batari-Basic/batari-Basic
* https://www.veripool.org/wiki/verilator
* http://mcpp.sourceforge.net/
* http://www.ifarchive.org/indexes/if-archiveXinfocomXcompilersXinform6.html
* https://github.com/dmsc/fastbasic
* https://github.com/wiz-lang/wiz
* https://github.com/sylefeb/Silice

### Assemblers/Linkers

* https://dasm-assembler.github.io/
* http://atjs.mbnet.fi/mc6809/Assembler/xasm-990104.tar.gz
* http://48k.ca/zmac.html
* https://github.com/apple2accumulator/merlin32
* https://github.com/camsaul/nesasm

### Dev Kits / Libraries

* https://shiru.untergrund.net/code.shtml
* http://www.colecovision.eu/ColecoVision/development/libcv.shtml
* https://github.com/toyoshim/tss

### Firmware

* http://www.virtualdub.org/altirra.html
* https://github.com/MEGA65/open-roms
* https://sourceforge.net/projects/cbios/
* https://www.pledgebank.com/opense

### Related Projects

* https://github.com/sehugg/8bitworkshop-compilers
* https://github.com/sehugg/8bit-tools
* https://github.com/sehugg/awesome-8bitgamedev
