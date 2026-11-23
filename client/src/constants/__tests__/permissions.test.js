import { describe, expect, test } from 'vitest';
import {
  PERMISSIONS, ROLE_ALLOWED_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, effectivePermissions,
  hasPermission, withPermissionDependencies,
} from '../permissions';
import * as server from '../../../../server/src/constants/permissions.js';

describe('owner and employee permissions', () => {
  test('client and server enforce the same defaults and owner-controlled grants', () => {
    expect(PERMISSIONS).toEqual(server.PERMISSIONS);
    expect(ROLE_ALLOWED_PERMISSIONS).toEqual(server.ROLE_ALLOWED_PERMISSIONS);
    expect(ROLE_DEFAULT_PERMISSIONS).toEqual(server.ROLE_DEFAULT_PERMISSIONS);
  });

  test('the owner can perform every store duty without explicit extra grants', () => {
    expect(effectivePermissions({ role: 'store_owner', permissions: [] }).sort()).toEqual(Object.values(PERMISSIONS).sort());
  });

  test.each(['staff', 'packer', 'delivery'])('allows combined duties for %s only when granted', (role) => {
    const user = { role, permissions: [PERMISSIONS.PACKING_MANAGE, PERMISSIONS.DELIVERY_MANAGE, PERMISSIONS.STAFF_MANAGE] };
    expect(hasPermission({ role }, PERMISSIONS.PACKING_MANAGE)).toBe(false);
    expect(hasPermission({ role }, PERMISSIONS.DELIVERY_MANAGE)).toBe(false);
    expect(hasPermission(user, PERMISSIONS.PACKING_MANAGE)).toBe(true);
    expect(hasPermission(user, PERMISSIONS.DELIVERY_MANAGE)).toBe(true);
    expect(hasPermission(user, PERMISSIONS.STAFF_MANAGE)).toBe(false);
  });

  test('granting combined duties includes the views and actions needed to use them', () => {
    expect(withPermissionDependencies([PERMISSIONS.PACKING_MANAGE, PERMISSIONS.DELIVERY_MANAGE, PERMISSIONS.ORDERS_ASSIGN])).toEqual(expect.arrayContaining([
      PERMISSIONS.PACKING_VIEW, PERMISSIONS.PACKING_PERFORM,
      PERMISSIONS.DELIVERY_VIEW, PERMISSIONS.DELIVERY_UPDATE, PERMISSIONS.ORDERS_VIEW, PERMISSIONS.STAFF_VIEW,
    ]));
  });
});
