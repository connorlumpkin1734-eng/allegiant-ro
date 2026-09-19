const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync('app/page.tsx', 'utf8');
const start = source.indexOf('function hasAuthorizationResponse(');
const end = source.indexOf('function authorizationDecisionSummary(');
const context = {};
vm.createContext(context);
vm.runInContext(ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 }), context);
const items = ['approved', 'declined', 'additional', null].map((id) => ({ service_group_id: id, quantity: 1, unit_price: 100, taxable: false }));
const authorization = { status: 'partially_approved', line_decisions: { approved: 'approved', declined: 'declined' }, approved_total: 200 };
const select = (auth, overrides) => Array.from(context.authorizedLineItems(items, auth, overrides), (item) => item.service_group_id);
test('new and declined jobs stay excluded without explicit override', () => {
  assert.deepEqual(select(authorization), ['approved', null]);
});
test('additional job is billed without changing the signed decision', () => {
  const original = JSON.stringify(authorization);
  assert.deepEqual(select(authorization, { additional: { note: 'Approved by text' } }), ['approved', 'additional', null]);
  assert.equal(JSON.stringify(authorization), original);
});
test('override applies only to the selected declined job and can be removed', () => {
  assert.deepEqual(select(authorization, { declined: { note: 'Approved by phone' } }), ['approved', 'declined', null]);
  assert.deepEqual(select(authorization, {}), ['approved', null]);
});
test('dashboard and invoice use the same persisted override total', () => {
  assert.equal(context.repairOrderTotal({ line_items: items, tax_rate: 0, latest_estimate_authorization: authorization, invoice_overrides: { additional: { note: 'Text approval' } } }), 300);
});
test('estimates without responses retain existing billing behavior', () => {
  assert.deepEqual(select(null), ['approved', 'declined', 'additional', null]);
});
