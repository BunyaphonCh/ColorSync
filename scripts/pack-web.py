"""Embed buildless website as gzip assets in UNO R4 flash (no SD card needed)."""
from pathlib import Path
import gzip
import re
root = Path(__file__).resolve().parents[1]
files = ['index.html', 'styles.css', 'app.js', 'settings.js', 'device-api.js', 'timeline.js', 'mock-device.js', 'storage.js', 'logo.js']
lines = ['// GENERATED FILE: edit dist files, then run scripts/pack-web.py. Do not edit these byte arrays.', '#pragma once', '#include <Arduino.h>', 'struct WebAsset { const char *path; const char *mime; const uint8_t *data; size_t length; };']
entries=[]
for i,name in enumerate(files):
    content=(root/'dist'/name).read_bytes()
    if name=='index.html':
        content=re.sub(rb'href="ColorSync-source.zip"\s+download', b'href="https://colorsync-play.cherrymite4.chatgpt.site/ColorSync-source.zip"', content)
    compressed=gzip.compress(content, compresslevel=9, mtime=0)
    lines.append(f'const uint8_t ASSET_{i}[] = {{'+','.join(str(b) for b in compressed)+'};')
    mime='text/html; charset=utf-8' if name.endswith('.html') else 'text/css' if name.endswith('.css') else 'text/javascript'
    entries.append(f'{{"/{name}","{mime}",ASSET_{i},sizeof(ASSET_{i})}}')
    if i==0: entries.append(f'{{"/","{mime}",ASSET_{i},sizeof(ASSET_{i})}}')
lines.append('const WebAsset WEB_ASSETS[] = {'+','.join(entries)+'};')
lines.append('const size_t ASSET_COUNT = sizeof(WEB_ASSETS)/sizeof(WEB_ASSETS[0]);')
(root/'firmware/ColorSync/web_assets.h').write_text('\n'.join(lines)+'\n')
print('Embedded',len(files),'web assets in firmware/ColorSync/web_assets.h')
