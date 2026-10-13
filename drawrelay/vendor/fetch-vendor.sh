#!/usr/bin/env sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
curl -fL https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js -o "$HERE/peerjs.min.js"
curl -fL https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js -o "$HERE/qrcode.min.js"
printf '%s\n' 'Vendored PeerJS 1.5.5 and QRCode.js 1.0.0.'
