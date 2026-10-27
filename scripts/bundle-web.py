"""Bundle this project's named-import modules for the small Arduino HTTP server."""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
names = ['settings.js', 'timeline.js', 'storage.js', 'mock-device.js', 'device-api.js', 'logo.js', 'app.js']
parts = ['(function () { "use strict";']
for name in names:
    text = (root/'dist'/name).read_text()
    text = re.sub(r'import\s*\{.*?\}\s*from\s*[\"\'][^\"\']+[\"\'];?', '', text, flags=re.S)
    text = re.sub(r'\bexport\s+(?=const |let |function |class )', '', text)
    parts.append('// ' + name + '\n' + text)
parts.append('})();')
(root/'dist/app.bundle.js').write_text('\n'.join(parts))
