# Square Drills for Android

Version **1.0.1** — local square-color and notation practice, extracted from Chess Tools with independent storage.

- Application ID and namespace: `com.codeguy.squaredrills`.
- Android 8.0 (API 26) or newer.
- Canonical package: [dist/SquareDrills.apk](dist/SquareDrills.apk), a **debug-signed APK** for local installation.
- Install alongside Chess Tools without replacing that application or opening its data.

The installed application works offline. It bundles the drill's HTML/CSS/JavaScript and uses Android WebView with a native SQLite bridge. It does not run Python or a web server, and has no accounts, analytics, cloud synchronization, or runtime internet dependency.

## Practice

Square Drills opens directly into the drill. Color is always required. The prompt can show Algebraic, White descriptive, Black descriptive, or Random; the notation supplied in the prompt is hidden from the answers and excluded from scoring. Required answers offers All fields, Color + White descriptive, Color + Algebraic, and Custom. Custom with no notation selected is color-only practice.

The [main guide's seven practical recipes](../README.md#how-to-set-up-each-drill) provide exact settings, examples, and timed/untimed instructions:

1. Algebraic prompt, color only.
2. Descriptive prompt, color only.
3. White descriptive from algebraic.
4. Black descriptive from algebraic.
5. Both descriptives from algebraic.
6. Algebraic from descriptive.
7. Mixed practice.

Set **Required answers** and Custom checkboxes first, then **Prompt shows last**. Changing required fields can correct an incompatible fixed prompt.

Tap the **Light** or **Dark** answer button, select a visible notation field, and use its file/rank buttons. Entry is touch-only and does not open the phone keyboard. **Clear answer** clears only the selected notation field. Before grading, tapping the selected color again clears it. The appearance **Light**/**Dark** controls are separate from the square-color answers.

With the timer off, use **Submit**, review feedback, then **Next** if questions remain. Missing answers count as wrong and show corrections. With the timer on, Submit is hidden: color-only taps grade immediately, and notation answers grade when color and all required file/rank pairs are complete. Partial answers wait. Correct timed answers advance immediately with cleared answers and a timer starting at zero, except on the final question. Wrong answers stay locked on the same square, keep submitted values, show corrections, and stop the timer until **Next** if questions remain. **Next** is unavailable until the current question is graded.

Each session grades all **64 unique squares exactly once**, in shuffled order. Grading the 64th answer always completes the session: correct or wrong, timed or untimed. The timer stops, the final answer and any corrections remain visible, and a summary shows **correct, incorrect, and accuracy**. There is no automatic restart or next cycle.

Choose **Reshuffle** to start a fresh session with a new shuffled order and score while preserving settings; abandoning a session in progress requires confirmation. During an unfinished session, **Reset session** requires confirmation and restarts the same shuffled order with a fresh score. **Reset session is disabled after completion; only Reshuffle starts the next session.** All seven recipes stop after their 64th graded answer until you choose Reshuffle.

The app tracks session progress, attempts, correct count, and accuracy, and pauses elapsed time while inactive. Toggling the timer or restoring a saved answer alone does not grade it or advance a checked result.

## Local storage and updates

The app creates its private SQLite database, `square_drills.db`, on first use. Android associates it and the WebView profile with `com.codeguy.squaredrills`. The database is not in shared storage. Windows, Chess Tools, and this Android app have independent stores; there is no automatic copying, import, or synchronization.

**Remember state** saves drill settings, progress, unfinished input, and checked feedback. Saves are ordered and state is flushed when backgrounding. Turning remembering off pauses future saves without deleting the previous snapshot. **Clear saved** requires confirmation and clears the drill snapshot; theme preferences are separate.

On the first launch of v1.0.1 with an old looping-drill save, the app resets that old progress while retaining answer mode, prompt choice, Custom selections, timer setting, Remember setting, and theme. **No backup or archive is made.** Saves using the new fixed-session format resume normally, including completed results, and are not reset on later launches.

Fresh installations start in the light theme with Algebraic prompt, All fields, all three Custom choices enabled, no question started, zero attempts/correct, timer off, and Remember state on. Distributed APKs contain no saved user data.

Update the existing installation using the same application ID and signing identity to preserve data. The canonical APK is debug-signed, so retain the build machine's existing debug signing identity for later updates. Signing keys and local SDK paths must stay outside published project files. A differently signed APK cannot update the existing installation in place.

**Uninstalling the app or clearing its storage deletes its saved data.** Cloud and device-transfer backups are disabled. There is no import/export feature. Any future transfer must be explicitly requested and implemented as a validated copy preserving its source. Unknown future database migrations fail instead of dropping tables.

## Architecture

| Location | Purpose |
| --- | --- |
| `app/src/main/assets/static/` | Shared drill assets plus Android API and touch/lifecycle support |
| `MainActivity.java` | WebView shell, native confirmations, insets, lifecycle state flush |
| `LocalContentClient.java` | Restricts content loading to the bundled local assets |
| `AndroidBridge.java` | Narrow JSON interface for drill state and settings |
| `AppDatabase.java` | Versioned app-private SQLite storage |
| `app/src/test/` | Headless native storage/bridge/shell tests |
| `tests/` | Actual-source Windows/Android JavaScript and DOM tests |

Java source files are under `app/src/main/java/com/codeguy/squaredrills/`. Only bundled application content is allowed in the WebView. File/content access is disabled; the package requests no network or storage permissions. A restrictive content security policy blocks external requests and frames. WebView debugging is enabled only in debug builds.

The standalone project owns every required source file. Shared assets are synchronized using the explicit file list in `../scripts/sync_android_assets.py`; platform-specific shells remain separate. It does not read assets from the original Chess Tools project at build time or runtime.

## Build and test

Use JDK 17 or newer, Android SDK platform 36, Gradle 8.13, and Android Gradle Plugin 8.13.0. The Gradle wrapper pins the Gradle version. Android Studio can locate the SDK automatically; for terminal builds, set `JAVA_HOME` and `ANDROID_HOME` to the local installations. Do not commit generated `local.properties` or signing credentials.

The packaging script requires an **existing Android debug keystore**. It uses `SQUARE_DRILLS_DEBUG_KEYSTORE` when set, otherwise the standard `.android/debug.keystore` under your user profile. You can also pass `-DebugKeystore` with the path to your existing key. If the key is missing, the script stops; it does not silently create or replace a signing identity. Preserve the same key for subsequent updates.

The packaging entry point, run from the project root, synchronizes shared assets and updates the canonical APK:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\build_android.ps1
```

For a nondefault existing key, append `-DebugKeystore "<path-to-existing-debug.keystore>"` to that command. The same path can be supplied through `SQUARE_DRILLS_DEBUG_KEYSTORE` for direct Gradle builds. Keep the path local rather than saving it in shared project files.

To run native build, unit tests, and lint directly from this `android` directory, synchronize the shared frontend first:

```powershell
python ..\scripts\sync_android_assets.py
.\gradlew.bat --no-daemon assembleDebug testDebugUnitTest lintDebug
```

The original Gradle APK at `app/build/outputs/apk/debug/app-debug.apk` is a build intermediate. The canonical distribution is `dist/SquareDrills.apk`, and it must match the successful build's APK byte-for-byte. Do not create alternate application IDs or versioned distribution directories to work around a running app or locked package.

The first Gradle build/sync may download build and test dependencies. Once dependencies are cached, add `--offline` for offline builds. The installed app needs no internet access.

For shared JavaScript/DOM tests, from this `android` directory:

```powershell
Set-Location tests
pnpm install --frozen-lockfile
node --test mobile.test.cjs
```

These tests execute the actual drill source from both platform asset folders. They require only the standalone project. Python API/storage tests are documented in the [main guide](../README.md#tests-and-manual-verification).

## Verification limits

Regression scope includes modes and eligible prompts, mandatory color, hidden prompted notation, incomplete/complete inputs, color-first/color-last entry, timed advancement, wrong-answer corrections and lock, one attempt per question, fixed 64-question sessions, completion on correct/wrong final answers with either timer setting, explicit session restarts, timer pauses/toggles, restored unfinished or checked state, clear-saved scope, touch entry, themes, native SQLite persistence, bridge validation, packaged assets, permissions, and safe migration failure. Record the commands actually run and their results for each delivery.

Headless native tests emulate Android APIs; DOM tests execute JavaScript in memory. They do not prove the complete native bridge and a real device's WebView work together visually. Manual device checks include:

- Portrait/landscape layout, text size, and comfortable touch targets.
- Square-color buttons, algebraic entry, and both descriptive perspectives.
- Light/dark interface readability and system bars.
- Timer grading, wrong-answer review, and background pause/resume.
- Reopening with remembered unfinished answers or checked feedback.
- Suppression of the phone keyboard, native confirmations, and Back behavior.

No desktop or device UI control is required by the background build/test commands.
