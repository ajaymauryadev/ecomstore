import ExcelJS from 'exceljs';
import unzipper from 'unzipper';
import Product, { UNIT_VALUES } from '../models/Product.js';
import { AppError } from '../utils/AppError.js';

export const PRODUCT_COLUMNS = ['name', 'brand', 'category', 'description', 'variant', 'unit', 'retailPrice', 'purchasePrice', 'wholesalePrice', 'offerPrice', 'stock', 'lowStockLimit', 'sku', 'barcode', 'isOnline', 'isActive'];
const key = (value) => String(value ?? '').trim().toLowerCase();
export const productImportKey = (name, brand) => JSON.stringify([key(name), key(brand)]);

export async function productSample() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.columns = PRODUCT_COLUMNS.map((header) => ({ header, key: header, width: ['name', 'description', 'category'].includes(header) ? 28 : 18 }));
  sheet.addRow({ name: 'Sample Rice', brand: 'Sample Brand', variant: '1 kg', unit: 'kg', retailPrice: 100, purchasePrice: 70, stock: 20, lowStockLimit: 5, sku: 'RICE-1KG', barcode: '001234567890', isOnline: true, isActive: true });
  sheet.addRow({ name: 'Sample Rice', brand: 'Sample Brand', variant: '5 kg', unit: 'bag', retailPrice: 480, purchasePrice: 350, stock: 10, lowStockLimit: 2, sku: 'RICE-5KG', isOnline: true, isActive: true });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF243247' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'P1' };
  ['sku', 'barcode'].forEach((column) => { sheet.getColumn(column).numFmt = '@'; });
  const instructions = workbook.addWorksheet('Instructions');
  instructions.getColumn(1).width = 110;
  [
    'Replace the example rows in Products before importing. Only .xlsx files are supported (2 MB, 500 variant rows maximum).',
    'Required columns: name, variant, retailPrice. One row per variant; matching name and brand group variants into one new product.',
    'Repeat the same brand, category, description, isOnline and isActive for each variant of a product.',
    'Imports create new products only. Existing products or duplicate SKU/barcodes are rejected; no rows are saved if any row is invalid.',
    'category: exact existing category name in your store, or leave blank. Ambiguous category names must be renamed first.',
    'stock and lowStockLimit: whole numbers from 0 to 1000000. Defaults: stock 0, lowStockLimit 5.',
    'Prices: numbers up to 100000000, with at most two decimal places. Optional prices can be blank; offer/wholesale must not exceed retail.',
    'isOnline and isActive: true/false or yes/no; blank means true. SKU/barcode: use Text format to preserve leading zeroes.',
    `unit: ${UNIT_VALUES.join(', ')}. Blank defaults to piece.`,
  ].forEach((line) => instructions.addRow([line]));
  return workbook.xlsx.writeBuffer();
}

export async function parseProductSpreadsheet(buffer, { tenantId, categories = [] }) {
  const workbook = new ExcelJS.Workbook();
  // XLSX is a ZIP container; bound its expanded size before the XML reader runs.
  try {
    const archive = await unzipper.Open.buffer(buffer);
    if (archive.files.length > 100 || archive.files.reduce((size, file) => size + file.uncompressedSize, 0) > 20 * 1024 * 1024) throw new Error('oversized');
  } catch { throw new AppError('The workbook is invalid or too large when expanded. Use the sample with at most 500 rows.', 400); }
  try { await workbook.xlsx.load(buffer); } catch { throw new AppError('The file is not a readable .xlsx workbook.', 400); }
  const sheet = workbook.getWorksheet('Products') || workbook.worksheets[0];
  if (!sheet) throw new AppError('The workbook has no product sheet.', 400);
  if (sheet.rowCount > 501 || sheet.columnCount > 40) throw new AppError('Use at most 500 variant rows and the sample columns.', 400);
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value ?? '').trim());
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new AppError('Column headings must be unique.', 400);
  if (['name', 'variant', 'retailPrice'].some((name) => !headers.includes(name))) throw new AppError('Missing required columns: name, variant, retailPrice. Download the sample workbook.', 400);
  if (headers.some((header) => header && !PRODUCT_COLUMNS.includes(header))) throw new AppError('Unknown column headings. Use the sample workbook columns.', 400);
  const groups = new Map();
  const identifiers = { sku: new Set(), barcode: new Set() };
  const errors = [];
  let rowCount = 0;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    try {
      const values = Object.fromEntries(headers.filter(Boolean).map((header) => {
        const cell = row.getCell(headers.indexOf(header) + 1);
        if (cell.value != null && typeof cell.value === 'object') throw new Error(`${header}: use plain values, without formulas or links.`);
        return [header, cell.value == null ? '' : String(cell.value).trim()];
      }));
      if (!Object.values(values).some(Boolean)) continue;
      rowCount += 1;
      const text = (field, max, required = false) => {
        const value = values[field] || '';
        if ((required && !value) || value.length > max) throw new Error(`${field}: ${required ? 'required, ' : ''}maximum ${max} characters.`);
        return value;
      };
      const number = (field, fallback, integer = false, positive = false) => {
        if (!values[field] && fallback !== undefined) return fallback;
        const value = Number(values[field]);
        const max = integer ? 1_000_000 : 100_000_000;
        if (!values[field] || !Number.isFinite(value) || value < 0 || (positive && value <= 0) || value > max || (integer && !Number.isSafeInteger(value)) || (!integer && Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)) throw new Error(`${field}: enter a valid ${integer ? 'whole number' : 'price (up to 2 decimals)'} between ${positive ? '0 (exclusive)' : '0'} and ${max}.`);
        return value;
      };
      const boolean = (field) => {
        if (!values[field]) return true;
        if (['true', 'yes', '1'].includes(key(values[field]))) return true;
        if (['false', 'no', '0'].includes(key(values[field]))) return false;
        throw new Error(`${field}: use true or false.`);
      };
      const categoryName = text('category', 200);
      const matches = categories.filter((category) => key(category.name) === key(categoryName));
      if (categoryName && matches.length !== 1) throw new Error('category: use a unique existing category name in your store.');
      const product = {
        tenantId, name: text('name', 200, true), brand: text('brand', 100), description: text('description', 1000),
        categoryId: categoryName ? matches[0]._id : null, isOnline: boolean('isOnline'), isActive: boolean('isActive'),
      };
      const variant = {
        name: text('variant', 80, true), unit: values.unit || 'piece', retailPrice: number('retailPrice', undefined, false, true),
        purchasePrice: number('purchasePrice', null), wholesalePrice: number('wholesalePrice', null, false, true), offerPrice: number('offerPrice', null, false, true),
        stock: number('stock', 0, true), lowStockLimit: number('lowStockLimit', 5, true), sku: text('sku', 100), barcode: text('barcode', 100),
      };
      if (!UNIT_VALUES.includes(variant.unit)) throw new Error('unit: use a unit from the Instructions sheet.');
      if ([variant.wholesalePrice, variant.offerPrice].some((value) => value != null && value > variant.retailPrice)) throw new Error('Offer and wholesale prices cannot exceed retail price.');
      const groupKey = productImportKey(product.name, product.brand);
      const group = groups.get(groupKey) || { ...product, variants: [], rows: [] };
      if (['description', 'categoryId', 'isOnline', 'isActive'].some((field) => String(group[field]) !== String(product[field]))) throw new Error('Product details must match across all its variants.');
      if (group.variants.length >= 100 || group.variants.some((entry) => key(entry.name) === key(variant.name))) throw new Error('Each product needs unique variant names and at most 100 variants.');
      for (const field of ['sku', 'barcode']) {
        if (variant[field] && identifiers[field].has(key(variant[field]))) throw new Error(`Duplicate ${field} in workbook.`);
      }
      for (const field of ['sku', 'barcode']) if (variant[field]) identifiers[field].add(key(variant[field]));
      group.variants.push(variant);
      group.rows.push(rowNumber);
      groups.set(groupKey, group);
    } catch (error) { errors.push({ row: rowNumber, message: error.message }); }
  }
  if (errors.length) throw new AppError('Fix the listed rows and upload again. No products were saved.', 400, errors);
  if (!groups.size) throw new AppError('Add at least one product row to the workbook.', 400);
  const products = [...groups.values()];
  for (const product of products) await new Product(product).validate();
  return { products, rowCount };
}
