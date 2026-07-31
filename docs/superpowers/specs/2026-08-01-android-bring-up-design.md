# Android Bring-Up — first successful build on an emulator

**Status:** Approved, ready for implementation plan
**Scope:** Local Android toolchain (outside the repo), Expo prebuild + Gradle for `apps/mobile`, and one new findings document. **No application source changes.**
**Branch:** `claude/android-build-setup-bf5835` (isolated worktree at `.claude/worktrees/android-build-setup-bf5835`)

## 1. Goals

Get the Race Pace runner app compiling, installing, and running on an Android emulator for the first time, and confirm it reaches real data.

The gate is: **signed in as `admin@racepace.test` with the Events tab showing the seeded events**, evidenced by a screenshot. Merely reaching the sign-in screen is not the gate — the app is sign-in-first, so everything worth verifying (networking to hosted Supabase, auth, navigation, list rendering) sits behind the login.

## 2. Non-goals

- **No parity fixes.** Android-specific rendering and behavior defects are *logged* to `docs/android-parity-findings.md`, not fixed. Known ones are listed in §7. This is deliberate: parity cannot be judged properly until the app can actually be seen running, and mixing "make it build" with "make it look right" makes both harder to verify.
- **No FCM / Android push.** `expo-notifications` needs a Firebase project, `google-services.json`, and FCM V1 credentials. That is external account setup, and it is its own project.
- **No `eas.json` / distribution.** No signed APK or AAB, no tester builds, no EAS account setup.
- **No physical device.** Emulator only. A real device is truer to the target audience (mid-range Android in the Philippines) but needs hands-on-keyboard and does not change anything about the toolchain work.
- **No Fast Refresh investigation.** Metro must attach well enough to serve the bundle (§5, Gate 5). Whether *edits* hot-reload is a separate known issue that also affects iOS.
- **No committed native project.** `apps/mobile/android/` stays gitignored and prebuild-generated, matching how iOS already works here.

## 3. Starting state

Established by inspection, not assumption:

**Machine**

| Component | State |
| --- | --- |
| Android Studio | Installed, with bundled JBR **JDK 21.0.10** |
| SDK platforms | `android-36.1` only |
| SDK build-tools | `36.1.0`, `37.0.0` |
| `platform-tools` (`adb`) | Present, **not on `PATH`** |
| `emulator` binary | Present |
| SDK license | `android-sdk-license` already accepted |
| `cmdline-tools` | **Missing** — so no `sdkmanager`, no `avdmanager` |
| System images | **Missing** |
| AVDs | **None** |
| `JAVA_HOME` / `ANDROID_HOME` | **Unset**; no JDK on `PATH` |
| Homebrew | 6.0.13, arm64, 391 GB free |

**Repo**

- `apps/mobile/android/` and `apps/mobile/ios/` are both gitignored — this is Expo CNG (Continuous Native Generation); native projects are prebuild output, not source.
- `app.json` already carries complete Android config: `package: com.racepace.mobile`, adaptive icon (foreground + background + monochrome all present in `assets/`), `predictiveBackGestureEnabled: false`.
- The **main checkout** (not this worktree) has a prebuild-generated `apps/mobile/android/` that has **never been built** — no `.gradle`, no `app/build`, no APK. Its Gradle wrapper is 9.3.1. It is useful as a reference for what prebuild emits; it is not the build target.
- `gradle.properties` from that prebuild confirms `newArchEnabled=true`, `hermesEnabled=true`, `edgeToEdgeEnabled=true`, `org.gradle.jvmargs=-Xmx2048m`, and `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`.
- This worktree has **no `apps/mobile/.env`**, only `.env.example`. The real `.env` exists in the main checkout.

## 4. What changes, and where

Three surfaces, separated because only one is version-controlled.

**Your machine** — Homebrew cask `android-commandlinetools`; one arm64 system image; one AVD; three exports appended to `~/.zshrc` (which exists, 5.8 KB). The `~/.zshrc` diff is shown for approval before it is applied.

**This worktree, uncommitted** — `apps/mobile/.env` copied from the main checkout, and `apps/mobile/android/` from prebuild. Both are gitignored, so neither can reach a commit.

**Committed to git** — this design document, the implementation plan, and `docs/android-parity-findings.md`. Nothing else.

If bring-up requires an application source change, that is a genuine finding: it gets committed with an explanation of why it was unavoidable, and called out rather than folded in silently. The design does not anticipate one — `app.json` already has everything Android needs.

### 4.1 `~/.zshrc` addition

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
```

`JAVA_HOME` points at Android Studio's bundled JDK 21 — the exact JDK Studio itself builds with, already installed, no download. The accepted trade-off is that it breaks if Android Studio is ever deleted; the fix then is a standalone Temurin install and a one-line edit.

## 5. The five gates

Each gate proves one layer before the next is built on it. This ordering exists because ~20 native modules autolink here (reanimated 4, expo-video, react-native-svg, screens, safe-area-context, notifications, image-picker, datetimepicker), the build is on the new architecture, and this Gradle project has never been built once. A single `expo run:android` would collapse toolchain, prebuild, native-build, and Metro failures into one indistinguishable wall of Gradle output.

### Gate 1 — Toolchain

`brew install --cask android-commandlinetools`; append §4.1 to `~/.zshrc`; `sdkmanager` the arm64 system image; `avdmanager` a Pixel-class AVD; boot it.

**Passes when** `adb devices` lists the emulator and `adb shell getprop sys.boot_completed` returns `1`.

No app code is involved. A broken emulator surfaces here, not forty minutes into a Gradle build.

### Gate 2 — Prebuild

Copy `.env` from the main checkout, then `npx expo prebuild --platform android --clean` in `apps/mobile`.

Per [`apps/mobile/AGENTS.md`](../../../apps/mobile/AGENTS.md), the versioned Expo v57 Android docs are read first rather than working from recalled API surface.

**Passes when** the generated `android/app/src/main/AndroidManifest.xml` contains the `racepace` scheme intent filter (the PayMongo redirect return path) and autolinking resolved the native modules above.

The stale prebuild in the main checkout already shows this is what prebuild emits — `.MainActivity`, `android:scheme="racepace"`, `windowSoftInputMode="adjustResize"`, `screenOrientation="portrait"` — so this gate is expected to pass and exists to catch drift, not to discover the format.

### Gate 3 — Gradle alone

```
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
```

Metro deliberately out of the picture, so any failure is unambiguously a native-build failure.

**Passes when** `BUILD SUCCESSFUL` and `android/app/build/outputs/apk/debug/app-debug.apk` exists.

The slowest gate — first run downloads the Gradle 9.3.1 distribution and the full dependency tree. `-PreactNativeArchitectures=arm64-v8a` narrows native compilation from four ABIs to the one the arm64 emulator actually needs, and is the single largest time saver available. It is a command-line flag, not an edit: `gradle.properties` is prebuild output and keeps all four ABIs for real builds.

### Gate 4 — Install + launch

`adb install -r` the APK, then `adb shell am start -n com.racepace.mobile/.MainActivity`.

**Passes when** `adb shell pidof com.racepace.mobile` still returns a PID ten seconds after launch, and `adb logcat *:E` shows no fatal.

Checking the process *survives* rather than merely starts is deliberate: a JS crash on the new architecture typically shows a window briefly before dying, which a naive launch check would score as success.

### Gate 5 — Runtime

`adb reverse tcp:8081 tcp:8081` so the dev client on the emulator can reach Metro on the host, start Metro, then drive sign-in with `adb shell input` and capture `adb exec-out screencap -p`.

**Passes when** a screenshot shows the Events tab populated with the seeded events, signed in as `admin@racepace.test`.

## 6. Risks and fallbacks

| Risk | Why it is likely | Fallback |
| --- | --- | --- |
| No arm64 system image for `android-36.1` | API 36.1 is Android 16 QPR — newer than most published arm64 images | Resolve the real ID from `sdkmanager --list`; drop to API 36 or 35. The app targets no specific API level, so this costs nothing. |
| Gradle OOM | `-Xmx2048m` is tight for a new-arch RN build | Raise heap via the `expo-build-properties` plugin — **not** by hand-editing `gradle.properties`, which prebuild regenerates |
| Metro will not attach | Fast Refresh is already known-broken in the iOS sim (embedded bundle, empty watchman); same root cause could bite here | **No fallback — this is the one genuine blocker.** A debug APK is useless without Metro. Debug it; do not declare success at Gate 4. |
| Login video stutters | `racepace-login-bg.mp4` via `expo-video` on an emulator | Cosmetic. Log it, do not gate on it. |

Gates 1–4 all have workarounds. Gate 5 does not, and that is stated plainly so it is not quietly downgraded if it fails.

## 7. Deliverable — `docs/android-parity-findings.md`

The logged-not-fixed list, each entry with file and line, seeded with what static inspection already found and extended with whatever the emulator surfaces:

- **`fontFamily: "Courier"`** — `app/ticket/[registrationId].tsx:61`, `app/pay/[registrationId].tsx:85`, `app/registration/[registrationId].tsx:86`. Courier does not exist on Android; it falls back to sans silently, so the ticket reference loses its monospace treatment. Android's equivalent is `monospace`.
- **Tab bar shadow** — `components/TrailTabBar.tsx:29-32` uses iOS-only `shadowColor`/`shadowOpacity`/`shadowRadius`/`shadowOffset` with no `elevation`. The new floating capsule will render with no shadow on Android. (`app/event/[id].tsx:80` does this correctly and can serve as the pattern.)
- **Edge-to-edge safe areas** — `edgeToEdgeEnabled=true` is forced on Expo SDK 54+. The floating capsule tab bar and `BrandHeader` need verification against both gesture navigation and 3-button navigation.
- **`KeyboardAvoidingView`** — `app/(auth)/sign-in.tsx:64` passes `behavior={Platform.OS === "ios" ? "padding" : undefined}`, i.e. undefined on Android. The manifest sets `windowSoftInputMode="adjustResize"`, so this may be fine in practice; it needs checking rather than assuming.
- **Hardware back button** — no `BackHandler` usage anywhere in the app, and `predictiveBackGestureEnabled: false`. Back behavior across the register/pay modal stack is unverified.
- **`RECORD_AUDIO` permission** — `app.json` lists `android.permission.RECORD_AUDIO`. Nothing in the app records audio; this looks like an Expo template leftover and would prompt avoidable Play Store review questions.
- **No FCM** — `app.config.js` conditionally strips the iOS `aps-environment` entitlement but there is no Android push path at all. Android push will fail silently until Firebase is set up.
- **No `eas.json`** — no cloud build or distribution configuration exists.

## 8. Verification

No new automated tests are written. This is toolchain setup and a native build; the existing Jest suite runs on the host under `jest-expo` and does not exercise the Android build path.

Verification is therefore the five gate checks in §5, each with an explicit machine-checkable pass condition (`adb` output, exit status, file existence, screenshot). Completion is claimed only against captured output from those commands, not against expectation.

The existing mobile test suite (`cd apps/mobile && pnpm test`) is run once at the end as a regression check. It is expected to be unaffected, but it runs from `apps/mobile` — the same directory that gains a `.env` and an `android/` tree — so "expected" is confirmed rather than assumed.
