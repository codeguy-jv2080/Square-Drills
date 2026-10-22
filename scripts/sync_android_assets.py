"""Copy only the shared standalone frontend into the Android asset tree."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SHARED = (
    "css/app.css",
    "css/square-drills.css",
    "js/modules/square-drills-core.js",
    "js/modules/square-drills.js",
)


def sync_assets():
    for relative in SHARED:
        source = ROOT / "app/static" / relative
        target = ROOT / "android/app/src/main/assets/static" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


if __name__ == "__main__":
    sync_assets()
    print(f"Synchronized {len(SHARED)} shared Square Drills assets.")
