import { readFileSync } from 'node:fs';
import process from 'node:process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OWNER_NAV_SECTIONS } from '../../components/layout/StoreOwnerLayout';
import { STAFF_NAV } from '../../components/layout/StaffLayout';
import { SUPER_ADMIN_NAV } from '../../components/layout/SuperAdminLayout';
import { dashboardRouteForRole, ROUTES } from '../routes';

const appSource = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const nestedPath = (fullPath, parent) => fullPath.slice(`${parent}/`.length);

describe('route and navigation integrity', () => {
  test('every rendered navigation target has a corresponding application route', () => {
    const targets = [
      ...OWNER_NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.to, '/store'])),
      ...STAFF_NAV.map((item) => [item.to, '/staff']),
      ...SUPER_ADMIN_NAV.map((item) => [item.to, '/super-admin']),
    ];
    for (const [target, parent] of targets) {
      expect(appSource, `Missing route for ${target}`).toContain(`path="${nestedPath(target, parent)}"`);
    }
  });

  test('redirects delivery and fulfillment roles to real staff routes', () => {
    expect(dashboardRouteForRole('delivery')).toBe(ROUTES.STAFF.DASHBOARD);
    expect(dashboardRouteForRole('packer')).toBe(ROUTES.STAFF.DASHBOARD);
    expect(dashboardRouteForRole('staff')).toBe(ROUTES.STAFF.DASHBOARD);
    expect(appSource).toContain('path="deliveries"');
    expect(appSource).toContain('path="orders"');
    expect(appSource).toContain('path="pos"');
  });
});
