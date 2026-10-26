from pathlib import Path
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
docs = root / "docs"
docs.mkdir(exist_ok=True)
for path in (root / "dist").iterdir():
    if path.is_file() and path.suffix in (".html", ".css", ".js"):
        shutil.copy2(path, docs / path.name)
(docs / ".nojekyll").touch()
# Archive reproducible source only; never include credentials or nested archives.
with zipfile.ZipFile(docs / "ColorSync-source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for directory in ("dist", "firmware", "scripts", "tests"):
        for path in (root / directory).rglob("*"):
            if path.is_file() and path.name != "secrets.h" and path.suffix != ".zip":
                archive.write(path, Path("ColorSync") / path.relative_to(root))
    for name in ("README.md", "GITHUB-PAGES.md", "package.json", ".gitignore"):
        if (root / name).exists():
            archive.write(root / name, Path("ColorSync") / name)
print("GitHub Pages files ready in docs/")
