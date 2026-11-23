import { expect } from '@playwright/test';
import { test } from './storefront-fixture.js';

test('many categories remain searchable and combined filters survive refresh and back navigation', async ({ page, storefront }) => {
  const { default: Category } = await import('../../server/src/models/Category.js');
  const slug = 'many-categories';
  const { store, product } = await storefront.seedStore(slug);
  const grocery = await Category.create({ tenantId: store._id, name: 'Grocery & Kitchen', emoji: '🛒', sortOrder: -2 });
  const fashion = await Category.create({ tenantId: store._id, name: 'Fashion', emoji: '👕', sortOrder: -1 });
  const categories = await Category.create(Array.from({ length: 40 }, (_, index) => ({
    tenantId: store._id, name: index === 39 ? 'Dairy & Bread' : `Category ${String(index).padStart(2, '0')}`,
    parentId: index % 2 ? grocery._id : fashion._id, emoji: index % 2 ? '🥛' : '👕',
  })));
  product.categoryId = categories[39]._id;
  product.isFeatured = true;
  product.variants[0].offerPrice = 75;
  await product.save();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${storefront.origin}/s/${slug}/categories`);
  await expect(page.getByRole('heading', { name: 'All Categories' })).toBeVisible();
  await expect(page.getByText('42 categories to explore')).toBeVisible();
  await page.screenshot({ path: '../output/category-directory-mobile.png' });
  await expect(page.getByRole('button', { name: 'Dairy & Bread', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View all 42 categories' }).click();
  await expect(page.getByRole('button', { name: 'Dairy & Bread', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Close categories' }).click();
  await page.getByRole('group', { name: 'Category groups' }).getByRole('button', { name: 'Fashion', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search categories' }).fill('Dairy');
  await expect(page.getByText(/No categories match/)).toBeVisible();
  await page.getByRole('group', { name: 'Category groups' }).getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Dairy & Bread', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`cat=${categories[39]._id}`));
  await expect(page.getByRole('searchbox', { name: 'Search categories' })).toHaveValue('Dairy');
  await page.getByRole('button', { name: 'In stock', exact: true }).click();
  await page.getByRole('button', { name: 'Offers', exact: true }).click();
  await page.getByRole('button', { name: /^Sort products:/ }).click();
  await page.getByRole('radio', { name: 'Price: Low to high', exact: false }).check();
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search store products' }).fill('Rice');
  await expect(page).toHaveURL(/categories\?.*q=Rice/);
  await expect(page.getByRole('link', { name: product.name, exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('cat')).toBe(String(categories[39]._id));
  await page.reload();
  await expect(page.getByRole('button', { name: 'In stock', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Sort products: Price: Low to high' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search store products' })).toHaveValue('');
  expect(new URL(page.url()).searchParams.get('cat')).toBe(String(categories[39]._id));
  await page.getByRole('button', { name: 'Featured', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Featured', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Featured', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).first().click();
  await page.getByRole('searchbox', { name: 'Search categories' }).fill('Dairy');
  await page.locator('.customer-scroll').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: '../output/category-browser-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.customer-scroll').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: '../output/category-browser-desktop.png' });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('parent categories include descendants and stock/offers use active variants in the same store', async ({ request, storefront }) => {
  const { default: Category } = await import('../../server/src/models/Category.js');
  const { store, product } = await storefront.seedStore('category-api');
  const parent = await Category.create({ tenantId: store._id, name: 'Groceries' });
  const child = await Category.create({ tenantId: store._id, name: 'Dairy', parentId: parent._id });
  const leaf = await Category.create({ tenantId: store._id, name: 'Milk', parentId: child._id });
  product.categoryId = leaf._id;
  product.variants[0].offerPrice = 10;
  await product.save();
  const make = (name, variants) => storefront.Product.create({ tenantId: store._id, categoryId: child._id, name, isOnline: true,
    variants: variants.map((variant) => ({ name: 'Pack', unit: 'piece', purchasePrice: 1, retailPrice: 20, stock: 5, ...variant })) });
  const cheap = await make('Cheap', [{ retailPrice: 8 }]);
  const unavailable = await make('Unavailable offer', [{ stock: 0, offerPrice: 2 }, { retailPrice: 200, offerPrice: null }]);
  await make('Inactive offer', [{ isActive: false, offerPrice: 1 }, { retailPrice: 30 }]);
  await make('Equal price', [{ offerPrice: 20 }]);
  const endpoint = `${storefront.origin}/api/v1/storefront/category-api/products`;
  const get = async (params) => {
    const response = await request.get(endpoint, { params });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const parentResults = await get({ categoryId: String(parent._id), sort: 'price_asc' });
  expect(parentResults.meta.total).toBe(5);
  expect(parentResults.data.slice(0, 2).map((row) => row._id)).toEqual([String(cheap._id), String(product._id)]);
  expect(parentResults.data[0]).not.toHaveProperty('tenantId');
  expect(parentResults.data[0].categoryId.name).toBe('Dairy');
  const descending = await get({ categoryId: String(parent._id), sort: 'price_desc' });
  expect(descending.data[0]._id).toBe(String(unavailable._id));
  const offers = await get({ categoryId: String(parent._id), offer: 'true', inStock: 'true' });
  expect(offers.data.map((row) => row._id)).toEqual([String(product._id)]);
  const { store: otherStore } = await storefront.seedStore('other-categories');
  const otherCategory = await Category.create({ tenantId: otherStore._id, name: 'Other category' });
  expect((await get({ categoryId: String(otherCategory._id) })).meta.total).toBe(0);
  expect((await request.get(endpoint, { params: { categoryId: 'invalid' } })).status()).toBe(400);
});

test('load more appends products and changing filters resets pagination', async ({ page, storefront }) => {
  const { store } = await storefront.seedStore('catalog-pagination');
  await storefront.Product.create(Array.from({ length: 27 }, (_, index) => ({
    tenantId: store._id, name: `Catalog item ${String(index).padStart(2, '0')}`, isOnline: true,
    variants: [{ name: 'Pack', unit: 'piece', purchasePrice: 1, retailPrice: index + 1, stock: 5 }],
  })));
  await page.goto(`${storefront.origin}/s/catalog-pagination?sort=name`);
  const cards = page.locator('.storefront-product');
  await expect(cards).toHaveCount(24);
  const first = await cards.first().innerText();
  await page.getByRole('button', { name: 'Load more products' }).click();
  await expect(cards).toHaveCount(28);
  expect(await cards.first().innerText()).toBe(first);
  await expect(page.getByRole('button', { name: 'Load more products' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Offers', exact: true }).click();
  await expect(page.getByText('No products match your search and filters')).toBeVisible();
  await expect(cards).toHaveCount(0);
  await page.getByRole('group', { name: 'Product filters' }).getByRole('button', { name: 'Offers', exact: true }).click();
  await expect(cards).toHaveCount(24);
});

test('modern search and filter sheets support keyboard, draft changes, previews and cancel', async ({ page, storefront }) => {
  const { default: Category } = await import('../../server/src/models/Category.js');
  const { store, product } = await storefront.seedStore('modern-discovery');
  const categories = await Category.create(['Dairy & Bread', 'Fruits', 'Snacks', 'Beverages', 'Grains', 'Home care', 'Personal care', 'Bakery'].map((name, index) => ({
    tenantId: store._id, name, emoji: ['🥛', '🍎', '🍿', '🧃', '🌾', '🧹', '🧴', '🥐'][index],
  })));
  product.categoryId = categories[0]._id;
  await product.save();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${storefront.origin}/s/modern-discovery/categories`);
  await expect(page.getByRole('link', { name: product.name, exact: true })).toBeVisible();
  await page.screenshot({ path: '../output/modern-categories-mobile.png' });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Filters & sort' });
  await expect(sheet.getByRole('checkbox', { name: /In stock/ })).toBeFocused();
  await sheet.getByRole('checkbox', { name: /Offers/ }).check();
  await expect(sheet.getByRole('button', { name: 'Apply filters', exact: true })).toHaveText('Show 0 results');
  expect(new URL(page.url()).searchParams.get('offer')).toBeNull();
  await page.screenshot({ path: '../output/modern-filters-mobile.png' });
  await sheet.getByRole('button', { name: 'Close filters' }).click();
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(sheet.getByRole('checkbox', { name: /Offers/ })).not.toBeChecked();
  await sheet.getByRole('searchbox', { name: 'Find filter category' }).fill('Dairy');
  await sheet.getByRole('radio', { name: /Dairy & Bread/ }).check();
  await sheet.getByRole('checkbox', { name: /In stock/ }).check();
  await sheet.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Filters (2 active)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Sort products:/ }).click();
  await sheet.getByRole('radio', { name: /Price: Low to high/ }).check();
  await sheet.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sort products: Price: Low to high' })).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Search store products' });
  await search.fill('Rice');
  const suggestions = page.getByRole('region', { name: 'Search suggestions' });
  await expect(suggestions.getByRole('link', { name: `Open product ${product.name}` })).toBeVisible();
  await search.press('ArrowDown');
  await expect(suggestions.getByRole('link', { name: `Open product ${product.name}` })).toBeFocused();
  await page.screenshot({ path: '../output/modern-search-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(suggestions).toHaveCount(0);
  await expect(search).toBeFocused();
  await search.fill('Dairy');
  await expect(suggestions.getByRole('link', { name: 'Browse category Dairy & Bread' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).first().click();
  await page.locator('.customer-scroll').evaluate((element) => { element.scrollTop = 0; });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '../output/modern-categories-desktop.png' });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
