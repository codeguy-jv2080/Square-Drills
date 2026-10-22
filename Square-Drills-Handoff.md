# Square Drills Windows portable and Android handoff

Extract the current **Square Drills** module into its own standalone app for **Windows portable and Android**, just like it works now. Reuse the existing code and preserve its features and behavior on both platforms. Leave the original Chess Tools application, releases, and saved data unchanged.

Place this file in a new sibling folder named `Square-Drills`, then open that folder as the project. The existing source should be available at `../Chess-tools`; application files do not need to be copied manually first.

## Scope and approval

This handoff authorizes planning, not an immediate rewrite. Inspect the source first, explain the proposed structure and storage, list the files to create or adapt in the new project, and wait for approval before implementation.

The required deliverables are a **Windows portable application** (EXE with its required supporting files and a clean distributable ZIP) and an **Android APK**, together with their source, build scripts, tests, and README. Both platforms are required. Ask only genuinely unresolved questions, one at a time.

The app should open directly into Square Drills, without the suite's module navigation. Keep this an extraction of the working module, not a redesign or feature expansion.

No new repository, push, installation, or changes to another application are authorized by this handoff alone.

## Verified source baseline

Use Chess Tools **v1.2.3**, commit `d9dc072ecc47a8ac178398aed5e22adbfa4ef5d4`, as the known working reference. Inspect any later local changes before choosing the extraction baseline; do not reset or overwrite them.

The current README and source supersede older drill handoffs. In particular, “no reveal” means no advance answer-reveal button. **Wrong answers must still show their corrections after grading.**

All paths below are relative to the existing `Chess-tools` project:

| Purpose | Source |
| --- | --- |
| Drill logic and notation rules | `app/static/js/modules/square-drills-core.js` |
| Controller, timer, input, feedback, persistence | `app/static/js/modules/square-drills.js` |
| Drill layout | `app/static/css/square-drills.css` |
| HTML and shared shell helpers | `app/static/index.html`, `app/static/js/app.js`, `app/static/css/app.css` |
| Android frontend | Corresponding files under `android/app/src/main/assets/static/`, plus `js/android-api.js`, `js/mobile.js`, and `css/mobile.css` |
| Android native shell and SQLite | `android/app/src/main/java/com/codeguy/chesstools/`: `MainActivity.java`, `AndroidBridge.java`, `AppDatabase.java`, `LocalContentClient.java` |
| Android build and resources | `android/` Gradle files and wrapper; `android/app/src/main/AndroidManifest.xml` and `res/` |
| Setup recipes and build instructions | `README.md`, `android/README.md` |
| Frontend regression tests | `android/tests/mobile.test.cjs` and its package configuration |
| Windows shell and storage | `launcher.py`, `app/main.py`, `app/database.py`, `requirements.txt`, `packaging/`, existing build scripts |
| Additional tests | `tests/test_core.py`, `android/app/src/test/java/com/codeguy/chesstools/` |

The two drill scripts are not a complete standalone application. They depend on the HTML `sd*` elements and `window.ChessTools` helpers, including registration, activation, API access, notifications, and clearing saved state. Preserve initialization, lifecycle handling, and ordered saves when simplifying the copied shell. Remove unrelated module code only from the new project.

## Behavior to preserve

### Prompts and answers

- One square is one question. Color is always required, including in Custom mode.
- Keep visible **Light** and **Dark** answer buttons above the notation fields. Do not restore a nonfunctional “Color required” field or use “Dark/Black” and “Light/White” labels.
- Keep the four answer modes: **All fields**, **Color + White descriptive**, **Color + Algebraic**, and **Custom**.
- Custom allows any combination of the three notation fields, including none for color-only practice.
- Prompts may show Algebraic, White descriptive, Black descriptive, or Random. The notation supplied by the prompt is hidden from the answer fields, never autofilled, and excluded from scoring.
- If only one notation is selected as an answer, it cannot also be the prompt. Random chooses only eligible formats. Preserve visible correction of incompatible fixed selections.
- Preserve descriptive perspective labels and existing accepted notation formats. For example, `e4` is Light, White descriptive `K4`, Black descriptive `K5`; `c3` is Dark, White `QB3`, Black `QB6`.
- Keep the file/rank keypad. Algebraic uses `a–h` and `1–8`; descriptive uses the existing descriptive file buttons and ranks. Clear answer affects only the selected notation field. Before grading, tapping the selected color again clears that choice.
- Android entry stays touch-only without the phone keyboard. Windows retains mouse-only entry and optional typing. Do not add a Keypad/Typing switch.

### Timed and untimed practice

With the timer enabled, **Submit is hidden and disabled**. Color-only practice grades immediately on the Light/Dark tap. Other modes grade on input when color and every required notation file/rank pair are complete. Partial answers must wait; completed wrong answers must be graded rather than waiting indefinitely.

A correct timed answer records one attempt and immediately advances to the next square, clearing the answers and restarting the timer at zero. A wrong answer stays on the same square, retains the submitted values, reveals the correct answers for missed fields, locks answers and settings, and stops the timer. The user presses Next after reviewing the mistake. **Never automatically skip a wrong answer.**

With the timer disabled, retain manual Submit, feedback, and Next. Missing required answers submitted manually count as wrong and show corrections. Toggling the timer alone must never grade existing input or advance an already checked result. Restoring saved state must not silently grade it either.

### Progress and persistence

Preserve shuffled 64-square cycles without repeats, cycle progress, attempts, correct count, accuracy, reset, and reshuffle. Count each question only once; color and every required notation must be correct for a correct attempt.

The optional elapsed timer is off by default. Preserve pauses while the app or drill is inactive, including Android lifecycle events. Preserve Remember state, confirmed Clear saved, unfinished answers, checked results, and serialized saves. Turning remembering off pauses future saves without erasing the previous saved snapshot.

Fresh defaults: light theme, Algebraic prompt, All fields, all three Custom notation choices enabled, no question started, zero attempts/correct, timer off, and Remember state enabled. No owner's saved progress or preferences should be distributed.

## README instructions to carry forward

Retain the seven practical recipes from the current README, with their examples and timed/untimed instructions. Set Required answers and Custom checkboxes first, then **Prompt shows last**, because changing required fields can change an incompatible prompt.

1. **Algebraic prompt, color only:** Custom, uncheck all notation fields, then Algebraic prompt. Color + Algebraic is not the color-only mode.
2. **Descriptive prompt, color only:** Custom with no notation fields, then White or Black descriptive prompt. Random can mix prompt formats.
3. **Enter White descriptive from algebraic:** Color + White descriptive, then Algebraic prompt.
4. **Enter Black descriptive from algebraic:** Custom with Black descriptive only, then Algebraic prompt.
5. **Enter both descriptives from algebraic:** Custom with both descriptive fields, then Algebraic prompt.
6. **Enter algebraic from descriptive:** Color + Algebraic, then White or Black descriptive prompt. Random alternates eligible descriptive formats.
7. **Mixed practice:** All fields, then Random or a fixed prompt; answer color and the two notation formats not shown.

Explain that theme Light/Dark controls are separate from square-color answer buttons. Do not replace these recipes with a generic mode list.

## Architecture and independent storage

Reuse the Android local WebView, bundled HTML/CSS/JavaScript, and native SQLite bridge. No Python backend is needed on Android. Preserve offline asset interception, restricted WebView access, and existing backup restrictions; do not add accounts, analytics, cloud synchronization, or a network dependency.

The new Android app needs its own application ID and matching namespace/package declarations. Proposed ID: `com.codeguy.squaredrills`; proposed database: `square_drills.db`. **Do not retain `com.codeguy.chesstools`**, which would target the existing Chess Tools installation. Keep app-private storage and WebView state independent. Do not import suite data automatically. Preserve the new app's signing identity on its subsequent updates.

For Windows, reuse the existing Python/FastAPI/SQLite/pywebview packaging. Keep the packaged launcher fix using Uvicorn `log_config=None`. Give the new app its own portable folder, executable, database, and WebView profile. Do not alter `dist/Chess Tools/Chess Tools.exe` or its data.

**Windows storage hazard:** the suite's `app/database.py` uses `CHESS_TOOLS_DATA_DIR` and can copy a legacy `%LOCALAPPDATA%/ChessTools/chess_tools.db` into portable storage. The new app must not inherit that override, fallback, or migration. Use standalone-specific paths and identifiers with no automatic cross-app transfer. Do not add an installed edition unless requested; any future installed edition must have storage separate from portable.

Copy needed source into the new project; do not create a runtime dependency or symlink to Chess Tools. Exclude `.git`, virtual environments, build caches, generated distributions, `local.properties`, signing credentials, databases, logs, personal paths, and saved settings. Create empty user storage on first use and preserve all existing local data.

## Appearance

Preserve the drill layout and workflow. Provide visible Light and Dark theme buttons using the user's standing appearance defaults, with accent `#007BFF` in both modes. Keep them visually distinct from the square-color answers.

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#F2F2F2` | `#202020` |
| Panels | `#FFFFFF` | `#2A2A2A` |
| Controls | `#FFFFFF` | `#353535` |
| Text | `#171717` | `#F5F5F5` |
| Secondary text | `#484848` | `#D2D2D2` |
| Borders | `#858585` | `#858585` |
| Hover | `#E6E6E6` | `#424242` |
| Focus | `#005FCC` | `#75BAFF` |
| Disabled text | `#696969` | `#A3A3A3` |
| Disabled background | `#E6E6E6` | `#262626` |
| Disabled border | `#B8B8B8` | `#555555` |
| Error text | `#A51B1B` | `#FFB7B7` |

Keep appearance changes limited to the standalone shell and the established theme requirements.

## Verification and delivery boundaries

Adapt the actual-source regression tests to the standalone shell on both Windows and Android. Cover every mode and prompt, color-only entry, partial versus complete input, color-first/color-last entry, timed correct advancement, wrong-answer corrections and lock, no double scoring, 64-square rollover, timer toggling/background pauses, restore, clear-saved scope, themes, Windows mouse/keyboard entry, and Android touch entry. Verify the new app and Chess Tools can coexist with independent saved data on both platforms. Verify both the Windows portable package and Android APK. Existing suite test results do not certify the extraction.

Use background checks and headless tests. Do not control the desktop, launch interactive windows, or close apps without specific authorization. Before rebuilding an existing standalone distribution, check whether it is running; if so, ask the user to close it and wait. Maintain one canonical distribution per authorized edition, updating its established path without duplicate releases or extra launchers.

Never alter, remove, disable, bypass, or suggest deleting existing GitHub workflows. GitLab is outside this task; existing GitHub-triggered mirrors have standing user authorization. If later asked to publish the whole project, include source and all current canonical runnable packages, clean of private data, and verify the remote files and package hashes. Preserve local working data and repository visibility; do not rewrite published history without separate authorization.

## Next session

Read this handoff and the applicable project instructions, inspect `../Chess-tools`, and present the exact proposed file structure and independent-storage plan for both Windows portable and Android. **Wait for the user's approval before creating or modifying application files.** Keep the extraction focused; do not redesign or remove working drill behavior.
