## Character PR

**Character id:** `characters/<id>/`
**Concept (one line):**

### Checklist
- [ ] I only changed files inside `characters/<my-id>/` (no `shared/`, `server/`, `client/`, `scripts/`, other characters, or `package.json`)
- [ ] `id` matches the folder name, and `name`, `author`, `description` are filled in
- [ ] `npm run validate -- <my-id>` shows **no auto-balance notes** (or I explain the remaining ones below)
- [ ] `npm test` passes
- [ ] I checked every state and all 16 moves in the Art Lab (`/lab.html?char=<my-id>`) with hitboxes on, and the hitboxes line up with the art
- [ ] I played it in training (`/?train=<my-id>`) and against a CPU
- [ ] No imports except `../../shared/art/*` or my own folder, and no network, timers or global side effects

### Notes / remaining auto-balance notes
<!-- Anything the reviewer should know. Screenshot or GIF welcome! -->

<!-- Changing the engine instead? Describe what and why, and expect a closer review. -->
