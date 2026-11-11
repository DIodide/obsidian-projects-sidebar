# Acknowledgments

## T3 Code

Reference repository: [pingdotgg/t3code](https://github.com/pingdotgg/t3code), pinned
to commit `d2c25950b4d9183ea342d5d5fc14c326b9e0172a` during implementation:

- [SidebarProjectFolderHeader.tsx](https://github.com/pingdotgg/t3code/blob/d2c25950b4d9183ea342d5d5fc14c326b9e0172a/apps/web/src/components/sidebar/SidebarProjectFolderHeader.tsx): compact icon/name rows, disclosure state, trailing actions.
- [useSidebarProjectGroups.ts](https://github.com/pingdotgg/t3code/blob/d2c25950b4d9183ea342d5d5fc14c326b9e0172a/apps/web/src/hooks/useSidebarProjectGroups.ts): stable project grouping and avoiding frequent whole-sidebar renders.
- [sidebarProjectGrouping.ts](https://github.com/pingdotgg/t3code/blob/d2c25950b4d9183ea342d5d5fc14c326b9e0172a/apps/web/src/sidebarProjectGrouping.ts): explicit project scope and identity.
- [fileTreeExpansion.ts](https://github.com/pingdotgg/t3code/blob/d2c25950b4d9183ea342d5d5fc14c326b9e0172a/apps/web/src/components/files/fileTreeExpansion.ts): independent expansion controls.

This is an independent implementation using Obsidian's native theme tokens and
Lucide icons. It does not bundle T3 Code source or its React/runtime dependencies.
