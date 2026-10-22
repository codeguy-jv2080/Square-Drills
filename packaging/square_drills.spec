from pathlib import Path

project_root = Path(SPECPATH).parent
a = Analysis(
    [str(project_root / "launcher.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=[(str(project_root / "app" / "static"), "app/static")],
    hiddenimports=["webview.platforms.edgechromium"],
    hookspath=[], runtime_hooks=[], excludes=[], noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True, name="Square Drills",
    debug=False, bootloader_ignore_signals=False, strip=False, upx=True,
    console=False, version=str(project_root / "packaging" / "version_info.txt"),
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=True, name="Square Drills")
