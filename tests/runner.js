// Tiny async test runner - no framework install needed, keeps the sandbox dependency-free
// apart from jsdom.
const suites = [];
let current = null;

function suite(name, fn) { current = { name, tests: [] }; suites.push(current); fn(); current = null; }
function test(name, fn) { current.tests.push({ name, fn }); }

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'not equal'}\n    expected: ${b}\n    actual:   ${a}`);
}

async function run() {
  let pass = 0, fail = 0;
  const failures = [];
  for (const s of suites) {
    console.log(`\n\x1b[1m${s.name}\x1b[0m`);
    for (const t of s.tests) {
      try {
        await t.fn();
        pass++;
        console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
      } catch (err) {
        fail++;
        failures.push({ suite: s.name, test: t.name, err });
        console.log(`  \x1b[31m✗ ${t.name}\x1b[0m`);
        console.log(`      ${String(err.message).split('\n').join('\n      ')}`);
      }
    }
  }
  console.log(`\n${'='.repeat(52)}`);
  console.log(fail === 0
    ? `\x1b[32mAll ${pass} tests passed\x1b[0m`
    : `\x1b[31m${fail} failed\x1b[0m, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
}

module.exports = { suite, test, assert, eq, run };
