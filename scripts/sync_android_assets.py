"""Copy the explicit shared frontend files and licensing documents into Android assets."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SHARED = (
    "css/app.css",
    "css/square-drills.css",
    "js/modules/square-drills-core.js",
    "js/modules/square-drills.js",
)
LICENSE_DOCUMENTS = ("LICENSE", "COPYRIGHT")


def sync_assets():
    for name in LICENSE_DOCUMENTS:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(f"The root {name} is required for the Android package.")
    for relative in SHARED:
        source = ROOT / "app/static" / relative
        target = ROOT / "android/app/src/main/assets/static" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    for name in LICENSE_DOCUMENTS:
        shutil.copyfile(ROOT / name, ROOT / "android/app/src/main/assets" / name)


if __name__ == "__main__":
    sync_assets()
    print(f"Synchronized {len(SHARED)} shared Square Drills assets and LICENSE/COPYRIGHT.")
