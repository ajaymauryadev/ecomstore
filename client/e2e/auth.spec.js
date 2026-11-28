import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const email = 'owner@example.test';
const password = 'Disposable-password-28';
const fieldInput = (page, label) => page.locator('input').and(page.getByLabel(label));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/auth/refresh')) {
      return route.fulfill({ status: 401, json: { message: 'Refresh token not found.' } });
    }
    return route.fulfill({ json: { data: [] } });
  });
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  for (const screen of [
    {
      path: 'login',
      heading: 'Sign in',
      submit: 'Sign in',
      alternate: 'Create a store',
      fields: ['Email Address', 'Password'],
    },
    {
      path: 'register',
      heading: 'Create your store',
      submit: 'Create store',
      alternate: 'Sign in',
      fields: ['Store Name', 'Store URL', 'Full Name', 'Email Address', 'Mobile Number', 'Password'],
    },
  ]) {
    test(`${screen.path} layout and keyboard flow at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto(`/${screen.path}`);
      await expect(page.getByRole('heading', { name: screen.heading })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);

      const brand = await page.getByText('Billing and POS').isVisible();
      expect(brand).toBe(viewport.width >= 900);
      const submit = page.getByRole('button', { name: screen.submit });
      expect((await submit.boundingBox()).height).toBeGreaterThanOrEqual(44);
      const screenshotPath = testInfo.outputPath(`${screen.path}-${viewport.width}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
      await testInfo.attach('Auth screenshot', { path: screenshotPath, contentType: 'image/png' });

      for (const field of screen.fields) {
        await page.keyboard.press('Tab');
        const input = fieldInput(page, field);
        await expect(input).toBeFocused();
        await expect(input).toHaveCSS('font-size', '16px');
        await expect(input).toHaveCSS('outline-width', '2px');
      }

      const passwordField = fieldInput(page, 'Password');
      await page.keyboard.type(password);
      await page.keyboard.press('Tab');
      const showPassword = page.getByRole('button', { name: 'Show password' });
      expect((await showPassword.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await expect(showPassword).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(passwordField).toHaveAttribute('type', 'text');
      await page.keyboard.press('Space');
      await expect(passwordField).toHaveAttribute('type', 'password');

      if (screen.path === 'login') {
        await page.keyboard.press('Tab');
        const remember = page.getByRole('checkbox', { name: 'Remember me' });
        await expect(remember).toBeFocused();
        await page.keyboard.press('Space');
        await expect(remember).toBeChecked();
      }

      await page.keyboard.press('Tab');
      await expect(submit).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: screen.alternate })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Enter');
      await expect(page.getByLabel(screen.fields[0])).toBeFocused();
      await expect(page.getByLabel(screen.fields[0])).toHaveAttribute('aria-invalid', 'true');

      if (viewport.width === 390 || viewport.width === 1440) {
        await page.addScriptTag({ content: axe.source });
        const violations = await page.evaluate(async () => (await window.axe.run()).violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        })));
        expect(violations).toEqual([]);
      }
    });
  }
}

async function fillRegistration(page, phone = '') {
  await page.getByLabel('Store Name').fill('Gulmohar Kirana');
  await page.getByLabel('Full Name').fill('Test Owner');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Mobile Number').fill(phone);
  await fieldInput(page, 'Password').fill(password);
}

test('registration shows pending state and establishes the owner UI session', async ({ page }) => {
  let request;
  await page.route('**/auth/register', (route) => { request = route; });
  await page.goto('/register');
  await fillRegistration(page);
  await expect(page.getByLabel('Store URL')).toHaveAccessibleDescription('Preview /s/gulmohar-kirana');
  await page.getByRole('button', { name: 'Create store' }).click();
  const pending = page.getByRole('button', { name: /Creating store/ });
  await expect(pending).toBeDisabled();
  await expect.poll(() => request?.request().postDataJSON()).toEqual({
    storeName: 'Gulmohar Kirana',
    storeSlug: 'gulmohar-kirana',
    name: 'Test Owner',
    email,
    password,
    role: 'store_owner',
  });
  await request.fulfill({
    status: 201,
    json: {
      data: {
        user: { _id: 'owner-1', name: 'Test Owner', role: 'store_owner' },
        accessToken: 'test-token',
        store: { _id: 'store-1', name: 'Gulmohar Kirana', slug: 'gulmohar-kirana' },
      },
    },
  });
  await expect(page).toHaveURL(/\/store\/dashboard$/);
  await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeVisible();
});

test('duplicate slug points to the store URL and retains safe registration details', async ({ page }) => {
  await page.route('**/auth/register', (route) => route.fulfill({
    status: 409,
    json: { message: 'Store URL is already taken.' },
  }));
  await page.goto('/register');
  await fillRegistration(page, '9876543210');
  const slug = page.getByLabel('Store URL');
  await slug.fill('market-corner');
  await page.getByLabel('Store Name').fill('Gulmohar Market');
  await expect(slug).toHaveValue('market-corner');
  await page.getByRole('button', { name: 'Create store' }).click();
  await expect(slug).toBeFocused();
  await expect(slug).toHaveAccessibleDescription(/This store URL is already taken/);
  await expect(slug).toHaveValue('market-corner');
  await expect(page.getByLabel('Store Name')).toHaveValue('Gulmohar Market');
  await expect(page.getByLabel('Full Name')).toHaveValue('Test Owner');
  await expect(page.getByLabel('Email Address')).toHaveValue(email);
  await expect(page.getByLabel('Mobile Number')).toHaveValue('9876543210');
  await expect(fieldInput(page, 'Password')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Create store' })).toBeEnabled();
});

test('registration displays structured validation beside the affected fields', async ({ page }) => {
  await page.route('**/auth/register', (route) => route.fulfill({
    status: 400,
    json: {
      message: 'Validation failed',
      errors: [
        { field: 'email', message: 'Valid email required' },
        { field: 'password', message: 'Password must be between 10 and 128 characters' },
      ],
    },
  }));
  await page.goto('/register');
  await fillRegistration(page);
  const emailField = page.getByLabel('Email Address');
  await page.getByRole('button', { name: 'Create store' }).click();
  await expect(emailField).toBeFocused();
  await expect(emailField).toHaveAccessibleDescription('Valid email required');
  await expect(fieldInput(page, 'Password')).toHaveAccessibleDescription('Password must be between 10 and 128 characters');
  await expect(emailField).toHaveValue(email);
});

test('invalid login preserves email and remember-me and can retry into the staff dashboard', async ({ page }) => {
  await page.route('**/auth/login', async (route) => {
    const credentials = route.request().postDataJSON();
    expect(credentials.email).toBe(email);
    expect(credentials.rememberMe).toBe(true);
    if (credentials.password !== password) {
      return route.fulfill({ status: 401, json: { message: 'Invalid email or password.' } });
    }
    return route.fulfill({
      json: {
        data: {
          user: { _id: 'staff-1', name: 'Test Staff', role: 'staff' },
          accessToken: 'test-token',
          store: { _id: 'store-1', name: 'Gulmohar Kirana' },
        },
      },
    });
  });
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('checkbox', { name: 'Remember me' }).check();
  const passwordField = fieldInput(page, 'Password');
  await passwordField.fill('wrong-password');
  await passwordField.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByLabel('Email Address')).toHaveValue(email);
  await expect(page.getByRole('checkbox', { name: 'Remember me' })).toBeChecked();
  await expect(passwordField).toHaveValue('');
  await passwordField.fill(password);
  await passwordField.press('Enter');
  await expect(page).toHaveURL(/\/staff\/dashboard$/);
});

for (const path of ['login', 'register']) {
  test(`${path} recovers from a network error`, async ({ page }) => {
    await page.route(`**/auth/${path}`, (route) => route.abort('internetdisconnected'));
    await page.goto(`/${path}`);
    if (path === 'register') {
      await fillRegistration(page);
    } else {
      await page.getByLabel('Email Address').fill(email);
      await fieldInput(page, 'Password').fill(password);
    }
    const submit = page.getByRole('button', { name: path === 'register' ? 'Create store' : 'Sign in' });
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText('Unable to reach the server. Check your connection and try again.');
    await expect(page.getByLabel('Email Address')).toHaveValue(email);
    await expect(fieldInput(page, 'Password')).toHaveValue('');
    await expect(submit).toBeEnabled();
  });
}

test('short desktop registration scrolls the form panel and keeps the brand fixed', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create your store' })).toBeVisible();
  const brand = page.getByRole('banner');
  const panel = page.getByRole('main');
  const top = (await brand.boundingBox()).y;

  await panel.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Create store' })).toBeInViewport();
  expect((await brand.boundingBox()).y).toBe(top);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
