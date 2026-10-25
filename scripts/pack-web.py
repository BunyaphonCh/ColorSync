"""Create the download bundle; never include Wi-Fi credentials or Git metadata."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
files=[root/name for name in ['README.md','READ-CODE-FIRST.md','API.md','package.json']]
for directory in ['dist','firmware','scripts','tests']:
    files += [p for p in (root/directory).rglob('*') if p.is_file() and p.suffix != '.zip' and p.name != 'secrets.h' and '__pycache__' not in p.parts]
with ZipFile(root/'dist/ColorSync-source.zip','w',ZIP_DEFLATED) as archive:
    for file in sorted(files): archive.write(file,'ColorSync/'+str(file.relative_to(root)))
print('Created dist/ColorSync-source.zip')
