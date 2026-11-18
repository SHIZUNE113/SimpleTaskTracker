// Copies exactly the three files the app needs into desktop/dist, which Tauri embeds into
// the exe. Nothing else from the repo (tests, node_modules, git data) can end up inside.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(__dirname, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const f of ['client-task-tracker.html', 'version.json', 'mascot.mp4']) {
  fs.copyFileSync(path.join(root, f), path.join(dist, f));
}
console.log('dist ready:', fs.readdirSync(dist).join(', '));
