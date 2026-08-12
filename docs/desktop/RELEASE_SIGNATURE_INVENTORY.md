# Which releases are signed, and what "signed" means

This page states plainly what cryptographic guarantees an OpenConstructionERP
download does and does not carry. It exists because "is it signed?" has four
different answers here and they do not agree with each other, so a single yes or
no would be misleading whichever way it went.

Numbers on this page are dated. To get current ones, run the command at the
bottom rather than trusting the text.

## The four mechanisms

They are produced by different jobs, they protect different things, and a
release can carry any subset of them.

| | Mechanism | What it proves | Who checks it |
| --- | --- | --- | --- |
| 1 | git tag signature | who cut the tag | anyone running `git tag -v` |
| 2 | Sigstore / cosign | these are the bytes we published | anyone running `cosign verify-blob` |
| 3 | macOS Developer ID and notarisation | who published the app, and that Apple scanned it | Gatekeeper, on every Mac |
| 4 | Windows Authenticode | who published the installer | SmartScreen, on every PC |

## Where we stand, as of 2026-08-12

**1. No git tag in this repository is signed.** Not one, across 325 tags. Tag
protection on GitHub restricts who may push a tag, which is a different thing:
it is an access control, not an attestation, and it leaves no artifact you can
check afterwards.

**2. Sigstore signatures exist from v14.5.0 onward.** Every release from v14.5.0
carries `SHA256SUMS`, `SHA256SUMS.sig` and `SHA256SUMS.pem`. Earlier history is
patchy: the signing workflow triggered on an event it could not actually
receive, so it worked in bursts and then not at all for a long stretch. Of the
239 releases before v14.5.0, 26 carry the three files. Treat a missing
signature on an older release as ordinary, not as a sign that something went
wrong with that release.

**3. No macOS build has ever been signed with a Developer ID certificate or
notarised by Apple.** The `.dmg` and `.app` are ad-hoc signed. An ad-hoc
signature seals the bundle, so its contents cannot be altered without breaking
the seal, and that part is real and is worth having. It does not identify a
publisher and Gatekeeper does not accept it. That is why the release notes ask
you to clear the quarantine attribute by hand: the app is not broken, it is
unsigned in the sense macOS cares about.

**4. No Windows installer has ever been Authenticode signed.** The `.exe` and
`.msi` carry no certificate, and SmartScreen warns about them. The pipeline is
ready and will sign them as soon as a certificate exists; see
[WINDOWS_SIGNING.md](WINDOWS_SIGNING.md) for exactly what has to be created. The
missing piece is the certificate, not the automation.

There is a difference between 3 and 4 worth keeping straight. Windows signing is
wired and waiting on a credential. macOS signing is not wired at all: the build
step is never handed the Apple credentials, so creating them would change
nothing on its own. See [MACOS_NOTARIZATION.md](MACOS_NOTARIZATION.md).

## What we do not claim

We do not claim that any published `.exe`, `.msi`, `.dmg` or `.app` is signed by
a certificate that identifies us. We do not claim any release is notarised. If
you see a page of ours saying otherwise, that page is wrong and we would like to
know about it.

We do claim, for releases from v14.5.0 onward, that the Sigstore signature over
`SHA256SUMS` was produced by our release workflow and covers the bytes we
published. That signature is made over the artifacts as they were uploaded, not
over a rebuild, so verifying a download against it is meaningful.

## Verifying a download yourself

For a release that carries the three files:

```
cosign verify-blob \
  --certificate SHA256SUMS.pem \
  --signature SHA256SUMS.sig \
  --certificate-identity-regexp 'https://github.com/datadrivenconstruction/OpenConstructionERP/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS

sha256sum -c SHA256SUMS
```

The first command establishes that the checksum manifest is ours. The second
establishes that your download matches it. Both have to pass; the first alone
says nothing about the file you downloaded.

To look at a platform signature directly, on macOS:

```
codesign -dv --verbose=4 /Applications/OpenConstructionERP.app
spctl --assess --type execute -vv /Applications/OpenConstructionERP.app
```

and on Windows, with the SDK's `signtool`:

```
signtool verify /pa /v OpenConstructionERP_x64-setup.exe
```

Today both of those report the absence described above. That is the expected
result, not a failed download.

## Regenerating this

```
python scripts/release_signature_inventory.py          # summary
python scripts/release_signature_inventory.py --all    # every release
```

The script reads the release list from the GitHub API, the tag objects from your
clone, and the credential wiring from the workflow files, and it labels every
answer with how it was obtained. It refuses to print an inventory if the API
page comes back short, because a truncated fetch looks exactly like a healthy
repository with fewer releases.

Two things it cannot do, stated so that a clean run is not over-read. It cannot
see a macOS or Windows signature on an individual published artifact, only
whether the pipeline could have produced one, so it argues from the cause and
says so. And it cannot read tag signatures from the API at all, only from a
local clone, so run it inside a checkout with `git fetch --tags` already done.
