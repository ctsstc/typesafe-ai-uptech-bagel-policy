#!/usr/bin/env bash
# Renders og/og.svg to public/og.png and og/icon.svg to public/apple-touch-icon.png.
# Usage: og/render.sh [in.svg out.png]  renders one 1200x630 card instead, for trying designs.
# Pango only loads raw TrueType, so the Mulish WOFF files from @fontsource/mulish are unpacked to
# TTF in a temp dir that a private fontconfig points at.
set -euo pipefail
cd "$(dirname "$0")/.."

fonts="$(mktemp -d)"
trap 'rm -rf "$fonts"' EXIT

python3 - "$fonts" node_modules/@fontsource/mulish/files/mulish-latin-{400,600,700,800,900}-normal.woff \
  node_modules/@fontsource/mulish/files/mulish-latin-{400,600}-italic.woff <<'PY'
import os, struct, sys, zlib

out_dir, *paths = sys.argv[1:]
for path in paths:
    data = open(path, "rb").read()
    flavor, _, num_tables = struct.unpack(">4sIH", data[4:14])
    entries = [struct.unpack(">4sIIII", data[44 + 20 * i : 64 + 20 * i]) for i in range(num_tables)]
    shift = 1 << (num_tables.bit_length() - 1)
    header = flavor + struct.pack(">HHHH", num_tables, shift * 16, shift.bit_length() - 1, num_tables * 16 - shift * 16)
    offset = 12 + 16 * num_tables
    directory, body = b"", b""
    for tag, off, comp_len, orig_len, checksum in entries:
        table = data[off : off + comp_len]
        if comp_len != orig_len:
            table = zlib.decompress(table)
        directory += struct.pack(">4sIII", tag, checksum, offset + len(body), orig_len)
        body += table + b"\0" * (-len(table) % 4)
    name = os.path.basename(path).replace(".woff", ".ttf")
    open(os.path.join(out_dir, name), "wb").write(header + directory + body)
PY

cat > "$fonts/fonts.conf" <<CONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <include ignore_missing="yes">/opt/homebrew/etc/fonts/fonts.conf</include>
  <dir>$fonts</dir>
  <!-- Fontsource names each static weight its own family (Mulish Black, ...). Folding them back into
       Mulish lets SVGs pick weights with font-weight instead of silently getting Bold. -->
  <match target="scan">
    <test name="family" compare="contains"><string>Mulish</string></test>
    <edit name="family" mode="assign_replace"><string>Mulish</string></edit>
  </match>
  <cachedir>$fonts/cache</cachedir>
</fontconfig>
CONF

render() {
  PANGOCAIRO_BACKEND=fc FONTCONFIG_FILE="$fonts/fonts.conf" rsvg-convert "$@"
}

if [[ $# -eq 2 ]]; then
  render -w 1200 -h 630 "$1" -o "$2"
  magick identify "$2"
  exit 0
fi

render -w 1200 -h 630 og/og.svg -o "$fonts/og.png"
magick "$fonts/og.png" -strip -dither None -colors 256 -define png:compression-level=9 PNG8:public/og.png
magick identify public/og.png

render -w 180 -h 180 og/icon.svg -o "$fonts/icon.png"
magick "$fonts/icon.png" -strip -define png:compression-level=9 public/apple-touch-icon.png
magick identify public/apple-touch-icon.png
