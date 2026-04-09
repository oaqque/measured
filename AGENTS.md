# Repo Agent Notes

## Apple Health Bridge

When working in `apps/apple-health-bridge`, prefer command-line builds only after
checking the locally managed Xcode signing assets.

The bridge cache is the private Apple Health source of truth. Do not assume the
bridge export should be shaped only around currently published workout fields.
`vault/apple-health/` is a private local cache boundary, and repo build steps
may project a smaller publishable subset from it later.

### Taildrop import note

- On this Linux machine, Taildrop deliveries may remain in the Tailscale inbox
  until they are explicitly fetched. Do not assume the file already exists in
  `~/Downloads`.
- Preferred retrieval command:

```bash
tailscale file get ~/Downloads
```

- Recent Apple Health imports arrived as normalized snapshot files:
  - `~/Downloads/cache-export.json`
  - `~/Downloads/export-manifest.json`
- Once fetched, import with:

```bash
pnpm run import:apple-health -- --from /home/willye/Downloads/cache-export.json
```

### Provisioning profile lookup

- Xcode-managed local provisioning profiles may live under:
  - `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`
- Do not assume the certificate team suffix matches the Apple team id used for
  provisioning. Derive the real team id from the profile.
- To inspect a local profile, decode it first:

```bash
security cms -D -i ~/Library/Developer/Xcode/UserData/'Provisioning Profiles'/<profile>.mobileprovision
```

- Useful fields to read from the decoded plist:
  - `TeamIdentifier`
  - `Name`
  - `ProvisionedDevices`
  - `Entitlements.application-identifier`

### Signing workflow

- If a matching Xcode-managed profile already exists for
  `au.oaqque.measured.apple-health-bridge`, prefer automatic signing with the
  profile's `TeamIdentifier`.
- For this repo, `xcodegen generate` alone is not sufficient for HealthKit.
  After generation:
  - ensure `Sources/App/AppleHealthBridge.entitlements` still contains the
    HealthKit keys
  - run `python3 scripts/ensure-healthkit-capability.py` from
    `apps/apple-health-bridge/` to patch the generated `.xcodeproj` with the
    HealthKit system capability
- The working command-line pattern is:

```bash
cd apps/apple-health-bridge
xcodegen generate
python3 scripts/ensure-healthkit-capability.py
xcodebuild \
  -project AppleHealthBridge.xcodeproj \
  -scheme AppleHealthBridge \
  -destination 'generic/platform=iOS' \
  DEVELOPMENT_TEAM=<team id from profile> \
  CODE_SIGN_STYLE=Automatic \
  build
```

- If install is needed and the phone is paired, use `devicectl`:

```bash
xcrun devicectl device install app --device '<device name>' '<path to .app>'
xcrun devicectl device process launch --device '<device name>' au.oaqque.measured.apple-health-bridge --activate --terminate-existing
```

### Notes

- The app should request only the plain workout-read HealthKit entitlements:
  - `com.apple.developer.healthkit = true`
  - `com.apple.developer.healthkit.background-delivery = true`
- Do not add `com.apple.developer.healthkit.access = health-records` for this
  bridge app. That is the Verifiable Health Records capability and caused the
  provisioning failure.
- The current local profile for this app is Xcode-managed and includes
  HealthKit, but the generated project still needs the patched HealthKit system
  capability for the signed app to keep the entitlement at runtime.
- After a signed build, verify the emitted entitlements with:

```bash
codesign -d --entitlements :- \
  ~/Library/Developer/Xcode/DerivedData/AppleHealthBridge-*/Build/Products/Debug-iphoneos/AppleHealthBridge.app
```

- The signed app should include `com.apple.developer.healthkit` before
  installing to device.
- `xcrun devicectl list devices` can see paired devices even when `xctrace`
  reports them inconsistently.
- A local code signing identity may exist in Keychain even when the wrong
  `DEVELOPMENT_TEAM` is supplied. Always trust the provisioning profile's team
  id over guesswork.
