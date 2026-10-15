# Daam Kingdom

Online Sri Lankan draughts for Android, iPhone, and the web.

The Android APK is built automatically by GitHub Actions. Open the **Actions** tab, select **Build Android APK**, and download the **Daam-Kingdom-APK** artifact from the latest successful run.


## Google Play build (.aab)

Every push to `main` builds a **signed Android App Bundle** for Google Play,
opens the same signed build on an Android emulator to check it starts, and
publishes both on the repo's **Releases** page:

- `…-PlayStore-…-code<N>.aab`: upload this in Play Console
- `….apk`: the same signed build, for installing directly on a phone

Signing uses the upload key in `signing/upload-keystore.jks.enc`, unlocked by the
repository secret `UPLOAD_KEYSTORE_PASSWORD`. Each build gets a higher version code
automatically.
