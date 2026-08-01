#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_icon="$project_dir/resources/icon.png"
output_icon="$project_dir/resources/icon.icns"
temp_dir="$(mktemp -d)"
iconset="$temp_dir/icon.iconset"

trap 'rm -rf "$temp_dir"' EXIT
mkdir -p "$iconset"

render_size() {
  local pixels="$1"
  local filename="$2"
  sips -z "$pixels" "$pixels" "$source_icon" --out "$iconset/$filename" >/dev/null
}

render_size 16 icon_16x16.png
render_size 32 icon_16x16@2x.png
render_size 32 icon_32x32.png
render_size 64 icon_32x32@2x.png
render_size 128 icon_128x128.png
render_size 256 icon_128x128@2x.png
render_size 256 icon_256x256.png
render_size 512 icon_256x256@2x.png
render_size 512 icon_512x512.png
render_size 1024 icon_512x512@2x.png

iconutil -c icns "$iconset" -o "$output_icon"
echo "已生成 $output_icon"
