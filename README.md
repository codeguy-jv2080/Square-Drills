# Square Drills

Version **1.0.1** — standalone square-color and chess-notation practice for Windows portable and Android.

Square Drills is licensed under **GPL-3.0-or-later**. See [LICENSE](LICENSE) and
[COPYRIGHT](COPYRIGHT). Both documents are included in the Windows portable
folder and Android APK. Third-party components retain their own licenses.

Square Drills opens directly into the drill. It retains the working drill from Chess Tools v1.2.3, with independent local SQLite storage. No accounts, cloud services, analytics, or internet connection are needed to use either application.

## Run the application

- **Windows:** extract [SquareDrills-portable.zip](dist/SquareDrills-portable.zip), then open `Square Drills.exe` in the extracted `Square Drills` folder. Keep the executable and its `_internal` folder together. Microsoft Edge WebView2 Runtime must be installed locally.
- **Android:** install [SquareDrills.apk](android/dist/SquareDrills.apk) on Android 8.0 (API 26) or newer. This is a **debug-signed APK** for local installation. See the [Android guide](android/README.md) for storage, updates, and build details.

The Windows source-build launch path is `dist\Square Drills\Square Drills.exe`. The portable folder can be moved as a whole. Keep its `data` folder when moving your own copy to retain progress; the distributable ZIP starts with empty user storage.

## Using the drill

One square is one question. **Color is always required**, including in Custom mode. The notation already supplied by the prompt is hidden from the answer fields, never filled in for you, and excluded from scoring. After grading, each incorrect required answer shows its correction. There is no advance answer-reveal control.

| Required answers | Selected answers before excluding the prompted notation |
| --- | --- |
| All fields | Color, Algebraic, White descriptive, Black descriptive |
| Color + White descriptive | Color and White descriptive |
| Color + Algebraic | Color and Algebraic |
| Custom | Color, plus any combination of the three notation fields |

Custom with no notation selected is color-only practice. **Prompt shows** offers Algebraic, White descriptive, Black descriptive, and Random. When exactly one notation is selected as an answer, that notation cannot also be the prompt. Random chooses only eligible formats. An incompatible fixed selection changes visibly to an eligible format. Descriptive prompts identify the White or Black perspective.

Each session contains **all 64 unique squares, graded exactly once** in shuffled order. It tracks session progress, attempts, correct answers, and accuracy. Color and every required notation must be correct for a correct attempt. **Next** is unavailable until the current question is graded, so it cannot skip an unanswered square.

Grading the 64th square completes the session, whether the answer is correct or wrong and whether the timer is on or off. The timer stops, the final answer and any corrections remain available for review, and the summary shows **correct, incorrect, and accuracy**. There is no automatic restart or next cycle.

Choose **Reshuffle** to start a new session in a new shuffled order with a fresh score, preserving the drill settings. Abandoning a session already in progress requires confirmation. During an unfinished session, **Reset session** requires confirmation and restarts the same shuffled order with a fresh score. **Reset session is disabled after completion; only Reshuffle starts the next session.** The final result remains available until you choose to reshuffle.

### Timed and untimed practice

The elapsed timer is **off by default**. With the timer off, fill the answers, press **Submit**, review the result, then press **Next** if questions remain. Missing required answers submitted manually count as wrong and show corrections.

With **Enable timer** on, **Submit is hidden and disabled**:

- Color-only practice checks immediately when you select **Light** or **Dark**.
- Notation practice checks on input once color and every required file/rank pair are complete. Partial answers wait; completed wrong answers are graded.
- A correct answer immediately starts the next square with its timer at zero and cleared answers, unless it is the 64th answer, which completes the session.
- A wrong answer stays on the same square with your submitted values and corrections. Answers and settings lock, and the timer stops. Review the mistake, then press **Next** if questions remain. A wrong 64th answer completes the session and keeps its corrections visible.

The timer pauses while the app is inactive. Toggling the timer alone never checks existing input or advances an already checked result. Restoring saved state does not silently grade an answer.

### How to set up each drill

Choose **Required answers** and any **Custom** checkboxes first, then set **Prompt shows last**. Changing required fields can change an incompatible prompt. If settings are locked after grading, press **Next** before changing them; after session completion, explicitly start another session with **Reshuffle**.

For every recipe below, press **Start** if the prompt says Ready. Otherwise, changing settings updates the current prompt. With the timer off, use **Submit**, review the result, then **Next** if questions remain. With the timer on, there is no Submit step: a correct answer advances immediately; a wrong answer waits for **Next** after showing corrections. **The 64th graded answer always stops at the session summary**, including a correct timed answer; no recipe starts another session automatically.

#### 1. Algebraic prompt, color only

1. Set **Required answers → Custom**.
2. Uncheck **Algebraic**, **White descriptive**, and **Black descriptive**.
3. Set **Prompt shows → Algebraic** last.
4. Answer **Light** or **Dark** only. For example, `e4` is **Light**.

With the timer on, your color tap checks immediately. With it off, press **Submit**, then **Next** after reviewing the result if questions remain. The 64th answer completes the session.

**Color + Algebraic is not color-only mode:** it asks you to enter algebraic notation from a descriptive prompt.

#### 2. Descriptive prompt, color only

1. Set **Required answers → Custom**.
2. Uncheck all three notation checkboxes.
3. Set **Prompt shows → White descriptive** or **Black descriptive** last.
4. Read the perspective label, then answer **Light** or **Dark** only.

For example, White descriptive `QB3` means `c3`, which is **Dark**. Black descriptive `QB6` means that same square. Choose **Random** to mix algebraic and both descriptive prompts while still answering only color.

With the timer on, your color tap checks immediately. With it off, press **Submit**, then **Next** after reviewing the result if questions remain. The 64th answer completes the session.

#### 3. Enter White descriptive from algebraic

1. Set **Required answers → Color + White descriptive**.
2. Set **Prompt shows → Algebraic** last.
3. Select the color and enter the White descriptive answer.

For an `e4` prompt, answer **Light** and `K4`.

With the timer on, completing color and the descriptive file/rank pair checks automatically. With it off, press **Submit**, then **Next** after reviewing the result if questions remain. The 64th answer completes the session.

#### 4. Enter Black descriptive from algebraic

1. Set **Required answers → Custom**.
2. Check **Black descriptive** only; uncheck **Algebraic** and **White descriptive**.
3. Set **Prompt shows → Algebraic** last.
4. Select the color and enter the Black descriptive answer.

For an `e4` prompt, answer **Light** and `K5`.

With the timer on, completing color and the descriptive file/rank pair checks automatically. With it off, press **Submit**, then **Next** after reviewing the result if questions remain. The 64th answer completes the session.

#### 5. Enter both descriptives from algebraic

1. Set **Required answers → Custom**.
2. Check **White descriptive** and **Black descriptive**; uncheck **Algebraic**.
3. Set **Prompt shows → Algebraic** last.
4. Select the color and complete both descriptive fields.

For an `e4` prompt, answer **Light**, White descriptive `K4`, and Black descriptive `K5`. Descriptive ranks are counted from the named side; the square's color stays the same.

With the timer on, color and both descriptive file/rank pairs must be complete before automatic grading. With it off, press **Submit**, then **Next** after reviewing the result if questions remain. The 64th answer completes the session.

#### 6. Enter algebraic from descriptive

1. Set **Required answers → Color + Algebraic**.
2. Set **Prompt shows → White descriptive** or **Black descriptive** last.
3. Select the color and enter the algebraic square.

White descriptive `K4` or Black descriptive `K5` requires **Light** and `e4`. **Random** alternates eligible White and Black descriptive prompts; algebraic cannot be the prompt when it is the only notation being answered.

With the timer on, completing color and the algebraic file/rank pair checks automatically. With it off, press **Submit**, then **Next** after reviewing the result if questions remain. The 64th answer completes the session.

#### 7. Mixed practice

1. Set **Required answers → All fields**.
2. Set **Prompt shows → Random** last, or choose one fixed format.
3. Select the color and enter the two notation formats not shown by the prompt.

An algebraic `e4` prompt asks for **Light**, White descriptive `K4`, and Black descriptive `K5`. A White descriptive `K4` prompt asks for **Light**, algebraic `e4`, and Black descriptive `K5`.

With the timer on, color and both visible notation file/rank pairs must be complete before automatic grading. With it off, press **Submit**, then **Next** after reviewing the result if questions remain. The 64th answer completes the session.

For another combination, choose **Custom**, select the notation fields to answer, and choose an eligible prompt last. Color always remains required.

### Entering and correcting answers

- The **Light** and **Dark** buttons in the appearance controls change the interface theme. The separate **Light** and **Dark** buttons above the notation fields answer the square's color.
- Before grading, selecting the same color again clears that choice.
- Select a visible notation field, then use its file and rank buttons. For `e4`, select **e** and **4**; for `K4`, select **K** and **4**. **Clear answer** clears only the selected notation field.
- Windows supports both mouse-only entry and optional typing. Android uses the on-screen controls without opening the phone keyboard. There is no Keypad/Typing switch.
- Wrong answers show corrections without replacing the submitted values. Answers stay locked until **Next**, except when a correct timed answer has already advanced. On the final question, the checked answer remains beside the session summary until you explicitly restart.

## Saved state and updates

**Remember state** preserves drill settings, progress, unfinished answers, and checked results. Turning it off pauses future saves without erasing the previous saved snapshot. **Clear saved** asks for confirmation before deleting the drill's stored snapshot. Theme preferences are stored separately.

On the first launch of v1.0.1 with progress saved by the old looping drill, that old progress is reset for the fixed-session format. Answer mode, prompt choice, Custom selections, timer setting, Remember setting, and theme are retained. **No backup or archive of the old progress is made.** Subsequent fixed sessions save and resume normally under Remember state, including completed-session results; this reset is not repeated for saves already using the new format.

Fresh defaults are light theme, Algebraic prompt, All fields, all three Custom notation choices enabled, no question started, zero attempts/correct, timer off, and Remember state enabled.

| Edition | Local storage |
| --- | --- |
| Windows portable | `data\square_drills.db` beside `Square Drills.exe`, with an independent WebView profile in that portable data directory |
| Windows source development | `data\dev\square_drills.db` under this project, with a separate development WebView profile |
| Android | App-private `square_drills.db` belonging to `com.codeguy.squaredrills`, with that application's own WebView data |

Each platform stores data independently. Square Drills does not open, copy, migrate, or synchronize Chess Tools data, and does not use its data-directory override. There is no automatic transfer between Windows and Android. The drill has no import/export feature.

To update Windows, close Square Drills and rebuild or replace the application in its established folder while preserving `data`. The build script preserves local data and excludes it from the clean ZIP; the one-time v1.0.1 progress reset described above occurs when the app loads an old-format save. Keep one canonical portable distribution and its existing executable name.

To update Android while retaining data, use the same application ID and signing identity. Keep the build machine's signing identity available for future debug APK updates; do not publish signing keys. Uninstalling Android or clearing its app storage deletes its data. Android cloud and device-transfer backups are disabled.

## Build from source

### Windows

Use Windows and Python 3.10 or newer. Install Microsoft Edge WebView2 Runtime locally if needed. From the project folder:

```powershell
.\setup.bat
.\.venv\Scripts\python.exe launcher.py
```

To build the portable application:

```powershell
.\build_windows.bat
```

The canonical outputs are:

```text
dist/Square Drills/Square Drills.exe
dist/Square Drills/_internal/
dist/SquareDrills-portable.zip
```

The executable requires its companion `_internal` folder. First-time setup/build may need internet access to download Python packages. After setup, using the packaged application is local and offline. Before rebuilding an existing distribution, ensure it is closed; a running or locked application must be closed before an in-place update.

### Android

Use the toolchain and commands in the [Android build guide](android/README.md#build-and-test). The packaging script requires an existing debug keystore; supply a nondefault key with `-DebugKeystore` or `SQUARE_DRILLS_DEBUG_KEYSTORE`, and retain that signing identity for future updates. From the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\build_android.ps1
```

The canonical APK is `android/dist/SquareDrills.apk`. Shared assets are synchronized within this project by `scripts/sync_android_assets.py`; no source or runtime dependency on the original Chess Tools folder remains.

## Project structure

```text
app/                       Windows local API, SQLite, and shared frontend
launcher.py                Local server and native Windows WebView shell
android/                   Android Studio project, native SQLite bridge, assets
packaging/                 Windows and Android packaging scripts/configuration
scripts/                   Explicit shared-asset synchronization
tests/                     Python API/storage regression tests
android/tests/             Actual-source JavaScript and DOM regression tests
dist/                      Canonical Windows portable distribution and ZIP
android/dist/              Canonical Android APK
```

Windows uses FastAPI on a loopback address, SQLite, and pywebview, packaged with PyInstaller. Android reuses the HTML/CSS/JavaScript in a local WebView backed by a native SQLite bridge; it runs no Python service. Source, local data, build caches, and distribution packages have separate locations.

## Tests and manual verification

Run Python tests from the project root after setup:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Run shared Windows/Android frontend tests:

```powershell
Set-Location android\tests
pnpm install --frozen-lockfile
node --test mobile.test.cjs
```

See the [Android guide](android/README.md#build-and-test) for native storage, bridge, shell, and lint checks. Regression checks cover drill modes/prompts, timed and untimed grading, wrong-answer corrections, fixed 64-question sessions and completion, explicit session restarts, persistence, themes, and platform input behavior. Test commands and scope are not a claim that a particular local build has passed; record the actual run results with each delivery.

Headless checks do not establish real-device or native-window visual behavior. Manual verification includes Windows window sizing, WebView2 rendering, keyboard/mouse entry, and Android portrait/landscape layout, touch targets, system bars, background/resume behavior, keyboard suppression, and native confirmation dialogs. Do these on the intended device before relying on a new build.
