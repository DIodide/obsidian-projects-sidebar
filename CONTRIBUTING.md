# Contributing

Bug reports, focused fixes, and accessibility improvements are welcome.

## Local development

Use Node.js 22 or newer. Keep this repository outside your vault so Obsidian does
not index development dependencies.

```sh
npm ci
npm test
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into a disposable test vault at
`.obsidian/plugins/projects-sidebar/`, enable the plugin, and reload after changes.
Use fictional notes when sharing screenshots or bug reports.

## Pull requests

Explain the user-facing change and how you verified it. For behavioral changes,
add a focused regression test. Run `npm test` and `npm run build`. For UI changes,
check keyboard navigation, light and dark themes, and a narrow sidebar in Obsidian.
The jsdom suite mocks the Obsidian API; it does not replace live app testing.

## Documentation images

`npm run screenshots` renders the actual sidebar source and CSS in a mock Obsidian
shell using a fully fictional, in-memory Fieldnotes vault. No personal vault is
read. Chrome is detected on macOS; elsewhere install Chromium with
`npx playwright install chromium`, or set `CHROME_PATH` to your browser executable.
The mock implements only the API needed for these illustrations; it is not a
standalone Obsidian replacement. Generated PNGs belong in `docs/images/`.

## Releases

Update `package.json`, its lockfile, `manifest.json`, and `versions.json` together.
`npm run package` builds a ZIP containing only the three plugin files and license.
Push a tag matching the manifest version (for example `1.0.0`, without a `v`) to
run tests and create a GitHub release with the ZIP and individual plugin files.
