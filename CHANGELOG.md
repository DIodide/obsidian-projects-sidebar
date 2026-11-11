# Changelog

## 1.1.0 — 2026-11-11

- Drag notes and folders onto folders, nested-project shortcuts, projects, or the project root to move them with Obsidian's link-aware file manager.
- Copy/paste files and whole folders with Ctrl+C/V or Cmd+C/V; copies get unique names.
- Delete the focused item with Ctrl+D, Cmd+D, or Delete, following Obsidian's confirmation and deletion settings.
- Add Copy, Paste, and Delete to tree context menus.
- Guard against overwrites, self/descendant moves, stale clipboard data, and overlapping operations.
- Require Obsidian 1.8.7+ for its native folder-copy API.

## 1.0.0 — 2026-11-11

Initial public release.

- Choose any vault folder as a project; filter and pin projects.
- Navigate a focused tree with independent expansion state per project.
- Treat nested projects as shortcuts in their parent project.
- Reveal the active file, create notes and folders, and navigate by keyboard.
- Window file-tree rows and refresh only on structural vault changes.
