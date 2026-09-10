/**
 * Role-based access.
 *
 * A technician was seeing the company KPI dashboard, the AI assistant and the
 * audit log of everyone's orders. These tests pin the split: which screens each
 * role may open (including by typing a URL), and which navigation they are shown.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpen, homeForRole, ROLE_SCREENS } from '../src/components/RequireRole';

test('a technician is limited to their own queue and their own history', () => {
  assert.deepEqual(ROLE_SCREENS.Technician, ['/jobs', '/my-activity']);
  assert.equal(canOpen('Technician', '/jobs'), true);
  assert.equal(canOpen('Technician', '/jobs/SS-2026-0001'), true, 'a specific job is still their own screen');
  assert.equal(canOpen('Technician', '/my-activity'), true);

  for (const management of ['/dashboard', '/ai', '/activity', '/review', '/orders']) {
    assert.equal(canOpen('Technician', management), false, `technician must not reach ${management}`);
  }
});

test('management screens belong to Admin and Manager', () => {
  for (const screen of ['/dashboard', '/ai', '/activity']) {
    assert.equal(canOpen('Admin', screen), true, `Admin: ${screen}`);
    assert.equal(canOpen('Manager', screen), true, `Manager: ${screen}`);
  }
  assert.equal(canOpen('Admin', '/review'), false, 'only a Manager reviews jobs');
  assert.equal(canOpen('Manager', '/review'), true);
  assert.equal(canOpen('Admin', '/orders'), true);
  assert.equal(canOpen('Manager', '/orders'), true, 'a manager may look up an order');
});

test('the review queue is manager-only and the technician queue is technician-only', () => {
  assert.equal(canOpen('Admin', '/jobs'), false);
  assert.equal(canOpen('Manager', '/jobs'), false);
  assert.equal(canOpen('Technician', '/review'), false);
});

test('each role lands on the screen it works in', () => {
  assert.equal(homeForRole('Technician'), '/jobs');
  assert.equal(homeForRole('Admin'), '/orders');
  assert.equal(homeForRole('Manager'), '/review');
});

test('unknown paths are not implicitly allowed', () => {
  assert.equal(canOpen('Technician', '/'), false);
  assert.equal(canOpen('Admin', '/secret'), false);
  // and a prefix match must not leak: /jobs-other is not /jobs
  assert.equal(canOpen('Technician', '/jobs-other'), false);
});
