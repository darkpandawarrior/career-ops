# Career Ops Desktop

This folder is the first desktop-app scaffold.

What it does:
- Launches the existing Next.js dashboard in a desktop window
- Keeps user data in the app's writable `userData/career-ops-data` folder by default
- Still uses the user's locally installed AI CLI from `PATH`

What it is not yet:
- A finished signed Windows `.exe` / macOS `.dmg`
- A fully packaged offline bundle

Next step to ship binaries:
1. Install desktop dependencies
2. Build the web app
3. Package this Electron shell with `electron-builder`
