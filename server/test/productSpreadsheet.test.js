import { beforeAll, describe, expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';

let parseProductSpreadsheet, productSample, PRODUCT_COLUMNS;
beforeAll(async () => {
  // The server suite shares one fork while Vitest isolates module caches.
  if (mongoose.models.Product) mongoose.deleteModel('Product');
  ({ parseProductSpreadsheet, productSample, PRODUCT_COLUMNS } = await import('../src/services/productSpreadsheet.service.js'));
});

const tenantId = '507f1f77bcf86cd799439011';
async function workbook(rows, columns = PRODUCT_COLUMNS) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Products');
  sheet.columns = columns.map((header) => ({ header, key: header }));
  rows.forEach((row) => sheet.addRow(row));
  return book.xlsx.writeBuffer();
}
const row = { name: 'Rice', variant: '1 kg', unit: 'kg', retailPrice: 100, stock: 20, barcode: '0012345' };
describe('Excel product validation', () => {
  test('the downloadable sample round-trips into one product with two variants', async () => {
    const parsed = await parseProductSpreadsheet(await productSample(), { tenantId });
    expect(parsed.rowCount).toBe(2);
    expect(parsed.products).toHaveLength(1);
    expect(parsed.products[0].variants[0].barcode).toBe('001234567890');
  });
  test('groups variants, resolves only supplied store categories, and preserves zero values', async () => {
    const buffer = await workbook([{ ...row, category: 'Food', stock: 0, lowStockLimit: 0, purchasePrice: 0, isOnline: false }, { ...row, variant: '5 kg', barcode: '00999', category: 'Food', isOnline: false }]);
    const result = await parseProductSpreadsheet(buffer, { tenantId, categories: [{ _id: tenantId, name: 'Food' }] });
    expect(result.products[0]).toMatchObject({ categoryId: tenantId, isOnline: false });
    expect(result.products[0].variants[0]).toMatchObject({ stock: 0, lowStockLimit: 0, purchasePrice: 0, barcode: '0012345' });
    await expect(parseProductSpreadsheet(buffer, { tenantId })).rejects.toMatchObject({ statusCode: 400, errors: [expect.objectContaining({ row: 2 }), expect.objectContaining({ row: 3 })] });
  });
  test.each([
    [{ ...row, retailPrice: -1 }, 'retailPrice'],
    [{ ...row, retailPrice: 1.123 }, 'retailPrice'],
    [{ ...row, stock: 1.5 }, 'stock'],
    [{ ...row, offerPrice: 101 }, 'exceed'],
    [{ ...row, unit: 'unknown' }, 'unit'],
    [{ ...row, isOnline: 'perhaps' }, 'isOnline'],
    [{ ...row, retailPrice: { formula: '1+1', result: 2 } }, 'formulas'],
  ])('reports invalid row values without accepting partial data', async (invalid, message) => {
    await expect(parseProductSpreadsheet(await workbook([row, invalid]), { tenantId })).rejects.toMatchObject({ statusCode: 400, errors: expect.arrayContaining([expect.objectContaining({ row: 3, message: expect.stringContaining(message) })]) });
  });
  test('rejects duplicate identifiers, missing headers, unreadable files and excessive rows', async () => {
    await expect(parseProductSpreadsheet(await workbook([row, { ...row, variant: '5 kg' }]), { tenantId })).rejects.toMatchObject({ errors: [expect.objectContaining({ message: expect.stringContaining('Duplicate barcode') })] });
    await expect(parseProductSpreadsheet(await workbook([row], ['name']), { tenantId })).rejects.toMatchObject({ statusCode: 400 });
    await expect(parseProductSpreadsheet(Buffer.from('invalid'), { tenantId })).rejects.toMatchObject({ statusCode: 400 });
    await expect(parseProductSpreadsheet(await workbook(Array(501).fill(row)), { tenantId })).rejects.toMatchObject({ statusCode: 400 });
  });
});
