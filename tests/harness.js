// Boots client-task-tracker.html in jsdom so tests exercise the real DOM + real handlers,
// not a re-implementation. Returns the live window so tests can click things.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'client-task-tracker.html'), 'utf8');

async function boot(opts = {}) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://shizune113.github.io/SimpleTaskTracker/client-task-tracker.html',
    pretendToBeVisual: true,
    beforeParse(window) {
      // No network in tests: version.json fetch is stubbed out.
      window.fetch = () => Promise.reject(new Error('offline in test'));
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.HTMLMediaElement.prototype.pause = () => {};
      if (opts.seed) opts.seed(window.localStorage);
    }
  });
  const w = dom.window;
  // init() is async; give it microtask + timer room to finish loadData/render.
  await new Promise(r => setTimeout(r, 60));
  w.__dom = dom;
  return w;
}

function click(w, el) {
  if (!el) throw new Error('click(): element not found');
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function $(w, sel) { return w.document.querySelector(sel); }
function $$(w, sel) { return Array.from(w.document.querySelectorAll(sel)); }

// Waits for pending async save/render work triggered by a click.
const settle = () => new Promise(r => setTimeout(r, 20));

// Simulates typing one character into a contenteditable, the way a real keystroke would:
// appends to the existing text node (or starts one), moves the cursor after it, and fires
// a real 'input' event with `data` set to that character - which is exactly what the inline
// calculator's trigger condition (e.data === '=') checks for.
function typeChar(w, editor, ch) {
  const sel = w.getSelection();
  let node, offset;
  if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    node = sel.anchorNode; offset = sel.anchorOffset;
  } else {
    // nothing focused yet - append to the editor's last text node, or create one
    node = editor.lastChild && editor.lastChild.nodeType === 3 ? editor.lastChild : editor.appendChild(w.document.createTextNode(''));
    offset = node.data.length;
  }
  if (node.nodeType === 3) {
    node.data = node.data.slice(0, offset) + ch + node.data.slice(offset);
    offset += 1;
  } else {
    node = editor.appendChild(w.document.createTextNode(ch));
    offset = 1;
  }
  const range = w.document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset);
  sel.removeAllRanges();
  sel.addRange(range);
  editor.dispatchEvent(new w.InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
}
function typeString(w, editor, str) { for (const ch of str) typeChar(w, editor, ch); }

module.exports = { boot, click, $, $$, settle, typeChar, typeString };
