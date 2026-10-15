#!/usr/bin/env bash
# Usage: smoke-test.sh <apk> <package>
# Installs the release APK on the emulator, opens it, and checks it keeps running.
set -x
APK="$1"; PKG="$2"
adb wait-for-device
adb install -r "$APK" > install.txt 2>&1; cat install.txt
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 25
adb shell pidof "$PKG" > pid.txt 2>&1 || echo "NOT RUNNING" > pid.txt
adb exec-out screencap -p > screen.png || true
# Tap the middle of the screen and make sure it survives.
SIZE=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -n1)
W=${SIZE%x*}; H=${SIZE#*x}
adb shell input tap $((W / 2)) $((H / 2)) || true
sleep 5
adb shell pidof "$PKG" > pid2.txt 2>&1 || echo "NOT RUNNING" > pid2.txt
adb logcat -d -v brief > logcat.txt 2>&1
echo "after launch: $(cat pid.txt)  after tap: $(cat pid2.txt)"
grep -q "NOT RUNNING" pid.txt pid2.txt && { echo "::error title=App closed::The app is not running after launch"; grep -E "FATAL|AndroidRuntime|E/flutter|Exception" logcat.txt | head -n 60; exit 1; }
exit 0
