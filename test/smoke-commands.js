const assert = require("assert");

const pkg = require("../package.json");

const commands = (pkg.contributes?.commands ?? []).map((c) => c.command);
const expected = [
  "lazydev.analyze",
  "lazydev.review",
  "lazydev.simplify",
  "lazydev.configureProvider",
  "lazydev.selectModel",
  "lazydev.clearKey",
];

for (const cmd of expected) {
  assert.ok(commands.includes(cmd), `missing command ${cmd}`);
}

console.log("Command registration smoke test passed.");
