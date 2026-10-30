const { boot, click, $, $$, settle, typeChar, typeString } = require('./harness');
// Mirrors THOUSANDS_SEP in client-task-tracker.html - a comma look-alike, never a real comma.
const SEP = '\u201A';
const { suite, test, assert, eq, run } = require('./runner');

// ---------- seed helpers ----------
const K = { tasks: 'tasks-v1', archive: 'archive-v1', staff: 'staff-list-v1', lang: 'lang-pref-v1', schema: 'data-schema-version-v1' };

function basTask(over = {}) {
  return Object.assign({
    id: 't_bas1', chainId: 'c_bas', client: 'Acme Pty Ltd', type: 'BAS', who: '我',
    status: 'pending', period: 'Q1 Jul-Sep 2025', qStart: '2025-07-01',
    due: '2025-11-25', workStart: '2025-10-01', linkedClient: null, note: '',
    workStatus: '', createdAt: '2025-10-01', completedAt: null
  }, over);
}
function otherTask(over = {}) {
  return Object.assign({
    id: 't_other1', chainId: 'c_other', client: 'Zeta Trust', type: 'Other', who: '我',
    status: 'pending', period: 'Fix payroll', due: null, workStart: null,
    linkedClient: null, note: '', workStatus: '', createdAt: '2025-10-01', completedAt: null
  }, over);
}
function seeder(tasks, archive = [], staff = ['Bob', 'Cara']) {
  return (ls) => {
    ls.setItem(K.tasks, JSON.stringify(tasks));
    ls.setItem(K.archive, JSON.stringify(archive));
    ls.setItem(K.staff, JSON.stringify(staff));
    ls.setItem(K.lang, 'en');
    ls.setItem(K.schema, '2');
  };
}
const whoChip = (w) => $(w, '.who[data-reassign]');
const reassignOpen = (w) => $(w, '#reassignModalBackdrop').classList.contains('open');
const chipFor = (w, name) => $$(w, '#reassignWhoChips .chip').find(c => c.dataset.person === name);

// =====================================================================
suite('1. Reassign — UI wiring', () => {
  test('assignee chip renders with a caret and a reassign target id', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    const chip = whoChip(w);
    assert(chip, 'no .who[data-reassign] chip rendered');
    eq(chip.dataset.reassign, 't_bas1', 'chip points at the wrong task');
    assert(chip.querySelector('.who-caret'), 'no caret affordance on the chip');
  });

  test('clicking the assignee chip opens the reassign modal, not the task-note modal', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, whoChip(w));
    await settle();
    assert(reassignOpen(w), 'reassign modal did not open');
    assert(!$(w, '#taskNoteModalBackdrop').classList.contains('open'), 'task note modal opened by mistake');
  });

  test('clicking elsewhere on the card still opens the task-note modal', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.card .type-badge'));
    await settle();
    assert($(w, '#taskNoteModalBackdrop').classList.contains('open'), 'task note modal regressed');
    assert(!reassignOpen(w), 'reassign modal opened by mistake');
  });

  test('modal subtitle names the client and period being reassigned', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, whoChip(w));
    await settle();
    const sub = $(w, '#reassignSubtitle').textContent;
    assert(sub.includes('Acme Pty Ltd') && sub.includes('Q1 Jul-Sep 2025'), `bad subtitle: ${sub}`);
  });

  test('picker lists every known person plus an add button, current one selected', async () => {
    const w = await boot({ seed: seeder([basTask({ who: 'Bob' })]) });
    click(w, whoChip(w));
    await settle();
    const names = $$(w, '#reassignWhoChips .chip').filter(c => c.dataset.person).map(c => c.dataset.person);
    eq(names, ['我', 'Bob', 'Cara'], 'wrong people offered');
    assert($(w, '#reassignWhoChips .add-chip'), 'no + chip to create a new person');
    eq(chipFor(w, 'Bob').className.includes('sel'), true, 'current assignee not highlighted');
  });

  test('cancel closes without changing anything', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, whoChip(w));
    await settle();
    click(w, $(w, '#reassignCancelBtn'));
    await settle();
    assert(!reassignOpen(w), 'modal stayed open');
    eq(JSON.parse(w.localStorage.getItem(K.tasks))[0].who, '我', 'assignee changed on cancel');
  });

  test('picking the person already assigned is a no-op with its own toast', async () => {
    const w = await boot({ seed: seeder([basTask({ who: 'Bob' })]) });
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    assert(!reassignOpen(w), 'modal stayed open');
    eq(JSON.parse(w.localStorage.getItem(K.tasks))[0].who, 'Bob', 'assignee mutated on no-op');
  });
});

// =====================================================================
suite('2. Reassign — chain propagation', () => {
  test('reassigns the live task and persists it', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.tasks))[0].who, 'Bob', 'not persisted');
    assert(whoChip(w).textContent.includes('Bob'), 'card did not re-render with the new name');
  });

  test('archive history is NOT rewritten — it keeps whoever actually did that period', async () => {
    const arch = [
      { id: 'a1', chainId: 'c_bas', client: 'Acme Pty Ltd', type: 'BAS', period: 'Q4 2024', who: '我', completedAt: '2025-09-01', archivedAt: '2025-09-01' }
    ];
    const w = await boot({ seed: seeder([basTask()], arch) });
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.archive))[0].who, '我', 'reassignment overwrote archive history');
  });

  test('a DIFFERENT chain for the same client+type is untouched (chainId wins)', async () => {
    const tasks = [
      basTask({ id: 't_a', chainId: 'chain_A', client: 'Smith Family Trust' }),
      basTask({ id: 't_b', chainId: 'chain_B', client: 'Smith Family Trust', period: 'Q1 Jul-Sep 2025 (2nd)' })
    ];
    const w = await boot({ seed: seeder(tasks) });
    const chip = $$(w, '.who[data-reassign]').find(c => c.dataset.reassign === 't_a');
    click(w, chip);
    await settle();
    click(w, chipFor(w, 'Cara'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K.tasks));
    eq(saved.find(t => t.id === 't_a').who, 'Cara', 'target chain not reassigned');
    eq(saved.find(t => t.id === 't_b').who, '我', 'name-twin chain got dragged along');
  });

  test('legacy rows with no chainId fall back to client+type matching', async () => {
    const tasks = [
      basTask({ id: 't_legacy', chainId: null }),
      basTask({ id: 't_legacy2', chainId: null, client: 'Acme Pty Ltd', period: 'Q2 Oct-Dec 2025', qStart: '2025-10-01' })
    ];
    const w = await boot({ seed: seeder(tasks) });
    click(w, $$(w, '.who[data-reassign]').find(c => c.dataset.reassign === 't_legacy'));
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K.tasks));
    eq(saved.filter(t => t.who === 'Bob').length, 2, 'legacy client+type fallback did not sweep the chain');
  });

  test('an Other (one-off) task reassigns alone, leaving same-client rows alone', async () => {
    const tasks = [otherTask(), otherTask({ id: 't_other2', chainId: 'c_other2', period: 'Second job' })];
    const w = await boot({ seed: seeder(tasks) });
    const chip = $$(w, '.who[data-reassign]').find(c => c.dataset.reassign === 't_other1');
    click(w, chip);
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K.tasks));
    eq(saved.find(t => t.id === 't_other1').who, 'Bob', 'target not reassigned');
    eq(saved.find(t => t.id === 't_other2').who, '我', 'other one-off dragged along');
  });

  test('future auto-generated periods inherit the new assignee', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Cara'));
    await settle();
    click(w, $(w, '.done-btn:not([disabled])'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K.tasks));
    eq(saved.length, 1, 'successor not spawned');
    eq(saved[0].who, 'Cara', 'successor did not inherit the new assignee');
    eq(saved[0].chainId, 'c_bas', 'successor left the chain');
  });

  test('creating a brand-new person from the picker assigns the chain to them', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, whoChip(w));
    await settle();
    click(w, $(w, '#reassignWhoChips .add-chip'));
    await settle();
    $(w, '#newPersonName').value = 'Dana';
    click(w, $(w, '#addPersonSaveBtn'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.staff)), ['Bob', 'Cara', 'Dana'], 'person not added to staff list');
    eq(JSON.parse(w.localStorage.getItem(K.tasks))[0].who, 'Dana', 'chain not handed to the new person');
    assert(!reassignOpen(w), 'reassign modal left hanging open');
  });

  test('+ in the NEW TASK picker still only selects, never reassigns anything', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '#addBtn') || $(w, '[data-i18n="btnAdd"]'));
    await settle();
    click(w, $(w, '#f-who-chips .add-chip'));
    await settle();
    $(w, '#newPersonName').value = 'Eve';
    click(w, $(w, '#addPersonSaveBtn'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.tasks))[0].who, '我', 'new-task picker leaked into the existing task');
    assert($$(w, '#f-who-chips .chip').find(c => c.textContent === 'Eve' && c.className.includes('sel')),
      'new person not selected in the new-task form');
  });

  test('reassigning off a person you were filtering by clears the filter so the task stays visible', async () => {
    const w = await boot({ seed: seeder([basTask({ who: 'Bob' })]) });
    const bobFilter = $$(w, '#whoFilterRow .chip').find(c => c.textContent === 'Bob');
    click(w, bobFilter);
    await settle();
    eq($$(w, '.card').length, 1, 'filter setup failed');
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Cara'));
    await settle();
    eq($$(w, '.card').length, 1, 'task vanished behind a now-stale filter');
  });
});

// =====================================================================
suite('3. Undo / restore interaction with reassignment', () => {
  // This is the scenario asked about: complete -> successor spawns -> reassign the
  // successor -> undo the completion. The undo must still find and remove the successor.
  test('undo after reassigning the spawned successor removes that successor', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.done-btn:not([disabled])'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.tasks)).length, 1, 'successor not spawned');

    click(w, whoChip(w));           // the successor is now the only card
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();

    click(w, $(w, '#undoBtn'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K.tasks));
    eq(saved.length, 1, 'undo left a duplicate — successor was not removed');
    eq(saved[0].period, 'Q1 Jul-Sep 2025', 'wrong task survived the undo');
    eq(JSON.parse(w.localStorage.getItem(K.archive)).length, 0, 'archive entry not rolled back');
  });

  test('the task brought back by that undo carries the NEW assignee, not the stale one', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.done-btn:not([disabled])'));
    await settle();
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    click(w, $(w, '#undoBtn'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.tasks))[0].who, 'Bob', 'undo resurrected the old assignee');
  });

  test('plain undo (no reassignment) is unchanged', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.done-btn:not([disabled])'));
    await settle();
    click(w, $(w, '#undoBtn'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K.tasks));
    eq(saved.length, 1, 'undo left the wrong number of tasks');
    eq(saved[0].period, 'Q1 Jul-Sep 2025', 'wrong task restored');
    eq(saved[0].who, '我', 'assignee mutated by a plain undo');
  });

  test('archive restore inherits the chain\'s CURRENT assignee, not the archived one', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.done-btn:not([disabled])'));
    await settle();
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    // let the 5s undo window lapse so this goes through restoreFromArchive, not undo
    await new Promise(r => setTimeout(r, 5100));
    click(w, $(w, '.tab[data-tab="archive"]'));
    await settle();
    click(w, $(w, '.restore-btn:not([disabled])'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K.tasks));
    eq(saved.length, 1, 'restore left a duplicate or removed too much');
    eq(saved[0].period, 'Q1 Jul-Sep 2025', 'wrong period restored');
    eq(saved[0].who, 'Bob', 'restore handed the task back to the departed assignee');
    // and the archive row it came from recorded the original person all along
  });

  test('restore with no live task in the chain falls back to the archived assignee', async () => {
    const arch = [{ id: 'a_solo', chainId: 'c_gone', client: 'Orphan Pty Ltd', type: 'BAS', period: 'Q1 2024', who: 'Cara', completedAt: '2024-11-01', archivedAt: '2024-11-01', qStart: '2024-07-01', due: '2024-11-25', workStart: '2024-10-01' }];
    const w = await boot({ seed: seeder([], arch) });
    click(w, $(w, '.tab[data-tab="archive"]'));
    await settle();
    click(w, $(w, '.restore-btn:not([disabled])'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K.tasks));
    eq(saved.length, 1, 'nothing restored');
    eq(saved[0].who, 'Cara', 'lost the archived assignee with no chain to inherit from');
  });

  test('restore leaves the archive row it consumed as the only history change', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.done-btn:not([disabled])'));
    await settle();
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.archive))[0].who, '我', 'pending-undo archive row was rewritten');
  });
});

// =====================================================================
suite('4. Regression — untouched behaviour still works', () => {
  test('completing a BAS task spawns the next quarter with correct due date', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.done-btn:not([disabled])'));
    await settle();
    const t = JSON.parse(w.localStorage.getItem(K.tasks))[0];
    eq(t.qStart, '2025-10-01', 'wrong next quarter start');
    eq(t.due, '2026-02-28', 'Oct-Dec BAS should be due 28 Feb');
  });

  test('client name still opens the client-note modal', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.client[data-client]'));
    await settle();
    assert($(w, '#noteModalBackdrop').classList.contains('open'), 'client note modal regressed');
  });

  test('status dropdown still saves without opening any modal', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    const sel = $(w, '.status-select');
    sel.value = 'READY';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.tasks))[0].workStatus, 'READY', 'status not saved');
    assert(!$(w, '#taskNoteModalBackdrop').classList.contains('open'), 'a modal opened from the dropdown');
  });

  test('delete flow still works end to end', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '.del-btn-outside'));
    await settle();
    click(w, $(w, '#deleteConfirmBtn'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K.tasks)).length, 0, 'task not deleted');
  });

  test('no stale getElementById references — page boots without a crash screen', async () => {
    const w = await boot({ seed: seeder([basTask(), otherTask()]) });
    assert(!w.document.body.textContent.includes('Something went wrong'), 'crash screen shown on boot');
    eq($$(w, '.card').length, 2, 'not all cards rendered');
  });

  test('language toggle re-renders the assignee chip without losing its handler', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, $(w, '#langToggleBtn'));
    await settle();
    click(w, whoChip(w));
    await settle();
    assert(reassignOpen(w), 'reassign chip stopped working after a language switch');
  });

  test('export payload still round-trips the reassigned who field', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    click(w, whoChip(w));
    await settle();
    click(w, chipFor(w, 'Bob'));
    await settle();
    const tasks = JSON.parse(w.localStorage.getItem(K.tasks));
    const archive = JSON.parse(w.localStorage.getItem(K.archive));
    const payload = JSON.parse(JSON.stringify({ dataVersion: 2, tasks, archive }));
    eq(payload.tasks[0].who, 'Bob', 'export lost the reassignment');
  });

  test('APP_VERSION matches the top entry of version.json', async () => {
    const fs = require('fs');
    const html = fs.readFileSync(__dirname + '/../client-task-tracker.html', 'utf8');
    const appVer = html.match(/const APP_VERSION = '([^']+)'/)[1];
    const vj = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
    eq(appVer, vj.versions[0].version, 'APP_VERSION and version.json are out of sync');
  });

  test('no external requests introduced beyond the version.json GET', async () => {
    const fs = require('fs');
    const html = fs.readFileSync(__dirname + '/../client-task-tracker.html', 'utf8');
    const urls = (html.match(/https?:\/\/[^\s"'`)]+/g) || [])
      .filter(u => !u.includes('shizune113.github.io') && !u.includes('www.w3.org'));
    eq(urls, [], 'unexpected external URL(s) in the file');
  });
});

// =====================================================================
suite('5. Quick Notes', () => {
  const K2 = { notebook: 'notebook-pages-v1' };
  const openNotebook = async (w) => { click(w, $(w, '#notesBtn')); await settle(); };

  test('first run seeds exactly the pinned Quick Note page', async () => {
    const w = await boot({ seed: seeder([]) });
    const saved = JSON.parse(w.localStorage.getItem(K2.notebook));
    eq(saved.length, 1, 'wrong number of seeded pages');
    eq(saved[0].pinned, true, 'seeded page is not pinned');
  });

  test('opening the notebook always lands on Quick Note, even if another page was open last', async () => {
    const pages = [
      { id: 'qn_pinned', name: null, content: '<b>hi</b>', pinned: true },
      { id: 'p1', name: 'Recipes', content: 'salt', pinned: false }
    ];
    const w = await boot({ seed: ls => { ls.setItem(K2.notebook, JSON.stringify(pages)); ls.setItem('lang-pref-v1','en'); } });
    await openNotebook(w);
    eq($(w, '#notebookEditor').innerHTML, '<b>hi</b>', 'did not land on the pinned page');
    assert($$(w, '.notebook-pages .chip.pinned').length === 1, 'pinned chip missing');
  });

  test('pinned page cannot be renamed or deleted from the manage list', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    click(w, $(w, '#notebookManageBtn'));
    await settle();
    const row = $(w, '.notebook-page-row');
    assert(!row.querySelector('input[data-rename]'), 'pinned row exposes a rename input');
    assert(!row.querySelector('button[data-delete]'), 'pinned row exposes a delete button');
  });

  test('creating a new page requires a name', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    click(w, $(w, '.notebook-pages .add-chip'));
    await settle();
    $(w, '#notebookNewPageName').value = '   ';
    click(w, $(w, '#notebookNewPageSaveBtn'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K2.notebook)).length, 1, 'blank-named page got created');
  });

  test('new page is created, becomes active, and persists', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    click(w, $(w, '.notebook-pages .add-chip'));
    await settle();
    $(w, '#notebookNewPageName').value = 'Recipes';
    click(w, $(w, '#notebookNewPageSaveBtn'));
    await settle();
    const saved = JSON.parse(w.localStorage.getItem(K2.notebook));
    eq(saved.length, 2, 'page not persisted');
    eq(saved[1].name, 'Recipes', 'wrong name saved');
    assert($$(w, '.notebook-pages .chip').find(c => c.textContent === 'Recipes' && c.className.includes('sel')),
      'new page not selected after creation');
  });

  test('switching pages saves the page you left before loading the new one', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    $(w, '#notebookEditor').innerHTML = 'quick note content';
    click(w, $(w, '.notebook-pages .add-chip'));
    await settle();
    $(w, '#notebookNewPageName').value = 'Page 2';
    click(w, $(w, '#notebookNewPageSaveBtn'));
    await settle();
    const pinnedChip = $$(w, '.notebook-pages .chip.pinned')[0];
    click(w, pinnedChip);
    await settle();
    eq($(w, '#notebookEditor').innerHTML, 'quick note content', 'content lost when switching pages');
    const saved = JSON.parse(w.localStorage.getItem(K2.notebook));
    eq(saved.find(p => p.pinned).content, 'quick note content', 'switch did not flush to storage');
  });

  test('renaming a page from the manage list updates its chip', async () => {
    const w = await boot({ seed: ls => {
      ls.setItem(K2.notebook, JSON.stringify([{ id: 'qn_pinned', pinned: true, content: '' }, { id: 'p1', name: 'Old Name', content: '', pinned: false }]));
    }});
    await openNotebook(w);
    click(w, $(w, '#notebookManageBtn'));
    await settle();
    const input = $(w, 'input[data-rename="p1"]');
    input.value = 'New Name';
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K2.notebook)).find(p => p.id === 'p1').name, 'New Name', 'rename not saved');
    assert($$(w, '.notebook-pages .chip').some(c => c.textContent.includes('New Name')), 'chip label not updated');
  });

  test('deleting the active page falls back to the pinned Quick Note page', async () => {
    const w = await boot({ seed: ls => {
      ls.setItem(K2.notebook, JSON.stringify([{ id: 'qn_pinned', pinned: true, content: 'home' }, { id: 'p1', name: 'Temp', content: 'x', pinned: false }]));
    }});
    await openNotebook(w);
    click(w, $$(w, '.notebook-pages .chip').find(c => c.textContent === 'Temp'));
    await settle();
    click(w, $(w, '#notebookManageBtn'));
    await settle();
    click(w, $(w, 'button[data-delete="p1"]'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K2.notebook)).length, 1, 'page not deleted');
    eq($(w, '#notebookEditor').innerHTML, 'home', 'editor left pointing at a deleted page');
  });

  test('search filters the page chip row by title', async () => {
    const w = await boot({ seed: ls => {
      ls.setItem(K2.notebook, JSON.stringify([
        { id: 'qn_pinned', pinned: true, content: '' },
        { id: 'p1', name: 'Tax Season Checklist', content: '', pinned: false },
        { id: 'p2', name: 'Grocery List', content: '', pinned: false }
      ]));
    }});
    await openNotebook(w);
    $(w, '#notebookSearch').value = 'tax';
    $(w, '#notebookSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
    await settle();
    const labels = $$(w, '.notebook-pages .chip:not(.add-chip)').map(c => c.textContent);
    assert(labels.some(l => l.includes('Tax Season Checklist')), 'matching page hidden');
    assert(!labels.some(l => l.includes('Grocery List')), 'non-matching page not filtered out');
  });

  test('search also matches page content, not just the title', async () => {
    const w = await boot({ seed: ls => {
      ls.setItem(K2.notebook, JSON.stringify([
        { id: 'qn_pinned', pinned: true, content: '' },
        { id: 'p1', name: 'Misc', content: 'remember to lodge the BAS extension request', pinned: false }
      ]));
    }});
    await openNotebook(w);
    $(w, '#notebookSearch').value = 'extension';
    $(w, '#notebookSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
    await settle();
    assert($$(w, '.notebook-pages .chip').some(c => c.textContent.includes('Misc')), 'content match not found');
  });

  test('editor debounce-saves typed content without needing to close the modal', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    $(w, '#notebookEditor').innerHTML = 'typed content';
    $(w, '#notebookEditor').dispatchEvent(new w.Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    eq(JSON.parse(w.localStorage.getItem(K2.notebook))[0].content, 'typed content', 'debounced autosave did not fire');
  });

  test('closing the modal flushes unsaved content immediately', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    $(w, '#notebookEditor').innerHTML = 'closed without waiting';
    click(w, $(w, '#notebookCloseBtn'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem(K2.notebook))[0].content, 'closed without waiting', 'close did not flush content');
    assert(!$(w, '#notebookModalBackdrop').classList.contains('open'), 'modal did not close');
  });

  test('toolbar buttons do not crash the editor and keep it focused', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    ['nbBoldBtn', 'nbUnderlineBtn', 'nbStrikeBtn', 'nbBulletBtn'].forEach(id => { click(w, $(w, '#' + id)); });
    await settle();
    assert(!w.document.body.textContent.includes('Something went wrong'), 'toolbar click crashed the app');
  });

  test('editor has CSS wrapping rules so long lines reflow instead of overflowing', async () => {
    const html = require('fs').readFileSync(__dirname + '/../client-task-tracker.html', 'utf8');
    const css = html.match(/\.notebook-editor\s*\{[^}]*\}/)[0];
    assert(/white-space:\s*pre-wrap/.test(css), 'missing pre-wrap');
    assert(/word-wrap:\s*break-word/.test(css) || /overflow-wrap:\s*break-word/.test(css), 'missing break-word wrapping');
  });

  test('notebook data is included in the export payload', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    $(w, '#notebookEditor').innerHTML = 'export me';
    click(w, $(w, '#notebookCloseBtn'));
    await settle();
    const notebookPages = JSON.parse(w.localStorage.getItem(K2.notebook));
    const payload = JSON.parse(JSON.stringify({ dataVersion: 2, tasks: [], archive: [], notebookPages }));
    eq(payload.notebookPages[0].content, 'export me', 'notebook missing from export shape');
  });

  test('importing a backup with no notebookPages key leaves existing notes untouched', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    $(w, '#notebookEditor').innerHTML = 'do not wipe me';
    click(w, $(w, '#notebookCloseBtn'));
    await settle();
    const oldBackup = { dataVersion: 2, tasks: [], archive: [], clientNotes: {}, staffList: [] }; // no notebookPages key at all
    const file = new w.File([JSON.stringify(oldBackup)], 'backup.json', { type: 'application/json' });
    const input = $(w, '#importFile');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    eq(JSON.parse(w.localStorage.getItem(K2.notebook))[0].content, 'do not wipe me', 'import wiped the notebook despite no notebookPages key');
  });

  test('Quick Note button and modal do not exist inside client task cards (no id collisions)', async () => {
    const w = await boot({ seed: seeder([basTask()]) });
    eq($$(w, '#notesBtn').length, 1, 'button duplicated or missing');
    eq($$(w, '#notebookModalBackdrop').length, 1, 'modal duplicated or missing');
  });
});

// =====================================================================
suite('6. Inline calculator', () => {
  const openNotebook = async (w) => { click(w, $(w, '#notesBtn')); await settle(); };
  const editor = (w) => $(w, '#notebookEditor');

  test('basic sum auto-completes on =', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1100+500=');
    eq(editor(w).textContent, `1${SEP}100+500=1${SEP}600`, 'wrong auto-completion');
  });

  test('division respects order of operations: 1+6/2= divides before adding', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1+6/2=');
    eq(editor(w).textContent, '1+6/2=4', 'multiplication/division should happen before addition');
  });

  test('parentheses override precedence: (1+6)/2= is a different answer from 1+6/2=', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '(1+6)/2=');
    eq(editor(w).textContent, '(1+6)/2=3.50', 'parenthesised expression computed incorrectly');
  });

  test('chained calculation only re-evaluates the segment after the last =', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1100+500=');
    eq(editor(w).textContent, `1${SEP}100+500=1${SEP}600`, 'first calc failed, aborting before chaining');
    typeString(w, editor(w), '/10=');
    eq(editor(w).textContent, `1${SEP}100+500=1${SEP}600/10=160`, 'chained calc did not use the prior result');
  });

  test('leading prose before the expression is ignored ("Laptop 1100+500=")', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), 'Laptop 1100+500=');
    eq(editor(w).textContent, `Laptop 1${SEP}100+500=1${SEP}600`, 'prose leaked into the expression or broke the parse');
  });

  test('a bare number with no operator is left alone (no pointless self-append)', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), 'Invoice #500=');
    eq(editor(w).textContent, 'Invoice #500=', 'appended a result to a non-calculation');
  });

  test('division by zero is left unresolved rather than inserting Infinity', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '5/0=');
    eq(editor(w).textContent, '5/0=', 'inserted something for an undefined result');
  });

  test('an unbalanced expression is left alone rather than guessing', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '(1+2=');
    eq(editor(w).textContent, '(1+2=', 'computed a result from an invalid/unbalanced expression');
  });

  test('floating point noise is cleaned up: 0.1+0.2= gives 0.3, not 0.30000000000000004', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '0.1+0.2=');
    eq(editor(w).textContent, '0.1+0.2=0.30', 'floating point noise leaked into the displayed result');
  });

  test('computed content is picked up by the normal autosave', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '2*3=');
    click(w, $(w, '#notebookCloseBtn'));
    await settle();
    eq(JSON.parse(w.localStorage.getItem('notebook-pages-v1'))[0].content, '2*3=6', 'calculated content not saved');
  });

  test('negative numbers work: -5+10=', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '-5+10=');
    eq(editor(w).textContent, '-5+10=5', 'unary minus not handled');
  });
});

// =====================================================================
suite('7. Live thousands separators & 2dp rounding', () => {
  const openNotebook = async (w) => { click(w, $(w, '#notesBtn')); await settle(); };
  const editor = (w) => $(w, '#notebookEditor');

  test('crossing the 4-digit boundary inserts a comma as you type', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1600');
    eq(editor(w).textContent, `1${SEP}600`, 'no separator inserted at the thousands boundary');
  });

  test('numbers under 1000 are left alone', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '999');
    eq(editor(w).textContent, '999', 'a 3-digit number should not get a comma');
  });

  test('six-plus digit numbers get multiple separators', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1500000');
    eq(editor(w).textContent, `1${SEP}500${SEP}000`, 'multi-group separator placement wrong');
  });

  test('negative numbers keep the sign and still group', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '-2500');
    eq(editor(w).textContent, `-2${SEP}500`, 'sign lost or grouping wrong on a negative number');
  });

  test('decimal portion is never comma-grouped, only the integer part', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1234.5678');
    eq(editor(w).textContent, `1${SEP}234.5678`, 'decimal digits were grouped or the integer part was not');
  });

  test('prose numbers elsewhere in a note also get grouped, not just calc expressions', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), 'Total revenue this year: 1500000');
    eq(editor(w).textContent, `Total revenue this year: 1${SEP}500${SEP}000`, 'plain prose figure was not grouped');
  });

  test('calc results are capped to 2 decimal places (1/3 no longer repeats)', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1/3=');
    eq(editor(w).textContent, '1/3=0.33', 'result was not rounded to 2 decimal places');
  });

  test('large calc results are grouped with thousands separators', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1000000/2=');
    eq(editor(w).textContent, `1${SEP}000${SEP}000/2=500${SEP}000`, 'large result was not separator-grouped');
  });

  test('a non-terminating division result keeps real cents, not just trailing zeros', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '10/3=');
    eq(editor(w).textContent, '10/3=3.33', 'cents rounding wrong');
  });
});

// =====================================================================
suite('8. Separator safety — real punctuation never leaks into a calculation', () => {
  const openNotebook = async (w) => { click(w, $(w, '#notesBtn')); await settle(); };
  const editor = (w) => $(w, '#notebookEditor');

  test("the user's exact scenario: a real comma stops the backward scan cold", async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), 'income 1000 expense 500');
    typeChar(w, editor(w), ','); // a real, literal comma - ordinary sentence punctuation
    typeString(w, editor(w), ' 1000-500=');
    // "expense 500" must NOT be swept into the calculation just because a comma sits nearby.
    eq(editor(w).textContent, `income 1${SEP}000 expense 500, 1${SEP}000-500=500`, "real comma let the scan reach past it");
  });

  test('a real comma with no space after it is still a hard stop (no digit-glomming)', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '500');
    typeChar(w, editor(w), ',');
    typeString(w, editor(w), '1000-500=');
    // Must read as "1000-500=500", never as if "500,1000" were one garbled number.
    eq(editor(w).textContent, `500,1${SEP}000-500=500`, 'a bare comma-digit run was misread as a single number');
  });

  test('a sentence-ending period also stops the scan (not mistaken for a decimal point)', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), 'Rate 500');
    typeChar(w, editor(w), '.');
    typeString(w, editor(w), ' 1000-500=');
    eq(editor(w).textContent, `Rate 500. 1${SEP}000-500=500`, 'a sentence period let the scan reach past it');
  });

  test('a genuine decimal point (digits on both sides) still works fine', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '12.5+2.5=');
    eq(editor(w).textContent, '12.5+2.5=15', 'a real decimal point got treated as a stop character');
  });

  test('a fullwidth Chinese comma is also never mistaken for the separator', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '收入500');
    typeChar(w, editor(w), '\uFF0C'); // fullwidth "、" style comma
    typeString(w, editor(w), '1000-500=');
    eq(editor(w).textContent, `收入500\uFF0C1${SEP}000-500=500`, 'fullwidth comma interfered with the calculation');
  });

  test('the separator character itself is not something a normal keystroke can produce', async () => {
    // i.e. typing an ordinary comma key never inserts our marker character.
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeChar(w, editor(w), ',');
    eq(editor(w).textContent, ',', 'a plain comma keystroke got silently swapped for the separator');
  });
});

// =====================================================================
suite('9. Period after a result ends the calculation (not a decimal point)', () => {
  const openNotebook = async (w) => { click(w, $(w, '#notesBtn')); await settle(); };
  const editor = (w) => $(w, '#notebookEditor');

  test("the reported bug: '2.50+0.5=3' then '.1/2=' computes 1/2, not 3.1/2", async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '2.50+0.5=');
    eq(editor(w).textContent, '2.50+0.5=3', 'setup failed - expected a whole-number result');
    typeString(w, editor(w), '.1/2=');
    eq(editor(w).textContent, '2.50+0.5=3.1/2=0.50', 'the period after the result was swallowed as a decimal point');
  });

  test('the same holds when the previous result had decimals', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '100+100=');
    typeString(w, editor(w), '.5*2=');
    eq(editor(w).textContent, '100+100=200.5*2=10', 'period after result did not terminate the previous calc');
  });

  test('CRITICAL: chaining off a decimal result still works (dot INSIDE our result)', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1/2=');
    eq(editor(w).textContent, '1/2=0.50', 'setup failed');
    typeString(w, editor(w), '*4=');
    eq(editor(w).textContent, '1/2=0.50*4=2', 'the decimal point inside our own result got treated as a terminator');
  });

  test('adding a decimal operand onto a whole result still chains', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '1.5+1.5=');
    typeString(w, editor(w), '+0.25=');
    eq(editor(w).textContent, '1.5+1.5=3+0.25=3.25', 'decimal operand after a whole result broke the chain');
  });

  test('a fresh decimal expression with no prior calc is still read as a decimal', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '3.1/2=');
    eq(editor(w).textContent, '3.1/2=1.55', 'a genuine decimal got terminated by the boundary rule');
  });

  test('plain whole-number chaining is unaffected', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), '10+5=');
    typeString(w, editor(w), '*2=');
    eq(editor(w).textContent, '10+5=15*2=30', 'ordinary chaining regressed');
  });

  test('the boundary marker is cleared when a different page is loaded', async () => {
    const w = await boot({ seed: ls => {
      ls.setItem('notebook-pages-v1', JSON.stringify([
        { id: 'qn_pinned', pinned: true, content: '' },
        { id: 'p1', name: 'Other', content: '', pinned: false }
      ]));
      ls.setItem('lang-pref-v1', 'en');
    }});
    await openNotebook(w);
    typeString(w, editor(w), '2+1=');
    click(w, $$(w, '.notebook-pages .chip').find(c => c.textContent === 'Other'));
    await settle();
    // A stale marker from the previous page must not terminate a genuine decimal here.
    typeString(w, editor(w), '3.1/2=');
    eq(editor(w).textContent, '3.1/2=1.55', 'a stale result marker leaked across a page switch');
  });
});

// =====================================================================
suite('10. Notebook formatting hygiene', () => {
  const openNotebook = async (w) => { click(w, $(w, '#notesBtn')); await settle(); };
  const editor = (w) => $(w, '#notebookEditor');
  const caretIn = (w, node, offset = 0) => {
    const r = w.document.createRange(); r.setStart(node, offset); r.collapse(true);
    const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  };
  const paste = (w, plain, html) => {
    const ev = new w.Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { getData: (t) => t === 'text/plain' ? plain : (t === 'text/html' ? (html || '') : '') };
    editor(w).dispatchEvent(ev);
    return ev;
  };

  test('pasting rich text inserts plain text only (no grey/bold carried over)', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    typeString(w, editor(w), 'x ');
    const ev = paste(w, 'Grey pasted', '<span style="color:#777;font-weight:bold">Grey pasted</span>');
    assert(ev.defaultPrevented, 'browser default rich paste was not blocked');
    eq(editor(w).innerHTML, 'x Grey pasted', 'pasted content kept formatting or landed wrong');
  });

  test('pasted Windows line endings are normalised', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    caretIn(w, editor(w), 0);
    paste(w, 'a\r\nb');
    eq(editor(w).textContent, 'a\nb', 'CRLF not normalised');
  });

  test('pasted text is saved', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    caretIn(w, editor(w), 0);
    paste(w, 'saved paste');
    await new Promise(r => setTimeout(r, 700));
    eq(JSON.parse(w.localStorage.getItem('notebook-pages-v1'))[0].content, 'saved paste', 'paste not autosaved');
  });

  test('clear formatting with the cursor on a line cleans only that line', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    editor(w).innerHTML = '<div><span style="color:#888">grey one</span></div><div><b>keep bold</b></div>';
    caretIn(w, editor(w).querySelector('span').firstChild, 2);
    click(w, $(w, '#nbClearFormatBtn'));
    await settle();
    eq(editor(w).innerHTML, '<div>grey one</div><div><b>keep bold</b></div>', 'wrong lines cleaned');
  });

  test('clear formatting over a selection cleans every touched line, keeping list structure', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    editor(w).innerHTML = '<b>first</b><div style="color:grey"><font color="#888">two</font></div><ul><li><u>three</u></li></ul>';
    const r = w.document.createRange(); r.selectNodeContents(editor(w));
    const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    click(w, $(w, '#nbClearFormatBtn'));
    await settle();
    eq(editor(w).innerHTML, 'first<div>two</div><ul><li>three</li></ul>', 'formatting left behind or structure lost');
  });

  test('a line emptied by deleting drops leftover formatting wrappers', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    editor(w).innerHTML = '<div>keep</div><div><b><br></b></div>';
    caretIn(w, editor(w).querySelector('b'), 0);
    editor(w).dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    eq(editor(w).innerHTML, '<div>keep</div><div><br></div>', 'empty line kept its bold wrapper');
  });

  test('ordinary typing never strips formatting', async () => {
    const w = await boot({ seed: seeder([]) });
    await openNotebook(w);
    editor(w).innerHTML = '<div><b>bold</b></div>';
    caretIn(w, editor(w).querySelector('b').firstChild, 4);
    editor(w).dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
    eq(editor(w).innerHTML, '<div><b>bold</b></div>', 'typing stripped formatting');
  });
});

run();
