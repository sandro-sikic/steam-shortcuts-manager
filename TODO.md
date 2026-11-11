# TODO

## Code-sign the Windows builds with SignPath Foundation

Windows shows "Windows protected your PC" (SmartScreen) for the installer and the portable `.exe`
because they are not signed. SignPath Foundation signs open-source projects for free.

- [ ] Make the repository public with an OSI-approved license (the project is MIT licensed).
- [ ] Apply for SignPath Foundation (https://signpath.org/) and wait for approval.
- [ ] Add the SignPath credentials to the repository as GitHub secrets.
- [ ] Add a signing step to the Windows job in `.github/workflows/release.yml` for both the installer and the portable `.exe`.
- [ ] Keep signing conditional on the secrets, so forks and builds without them still produce unsigned packages.
- [ ] Add a config test and a README section, as for the other packaging settings.

Until then, users click "More info" and "Run anyway".
