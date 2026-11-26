import multer from 'multer';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import StockLedger from '../models/StockLedger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import { runInTransaction } from '../utils/transaction.js';
import { lockCategoryReferences } from '../services/categoryHierarchy.service.js';
import { parseProductSpreadsheet, productSample, productImportKey } from '../services/productSpreadsheet.service.js';
import { workloadGate } from '../middleware/workloadGate.js';

const admitWorkbook = workloadGate(1, 'A workbook is being processed. Please retry shortly.');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1 }, fileFilter: (req, file, done) => done(null, /\.xlsx$/i.test(file.originalname)) }).single('file');
export const uploadProductWorkbook = (req, res, next) => upload(req, res, (error) => {
  if (error) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 'Workbook must be 2 MB or smaller.' : 'Upload one .xlsx file.', 400));
  if (!req.file) return next(new AppError('Choose an Excel .xlsx file.', 400));
  next();
});

export const downloadProductSample = admitWorkbook(asyncHandler(async (req, res) => {
  const buffer = await productSample();
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="product-import-sample.xlsx"');
  res.send(Buffer.from(buffer));
}));

export const importProducts = admitWorkbook(asyncHandler(async (req, res) => {
  const result = await runInTransaction(async (session) => {
    // Serialize catalog imports and category edits, including concurrent duplicate imports.
    await lockCategoryReferences(req.tenantId, session);
    const categories = await Category.find({ tenantId: req.tenantId }).select('name').session(session).lean();
    const { products, rowCount } = await parseProductSpreadsheet(req.file.buffer, { tenantId: req.tenantId, categories });
    const existing = await Product.find({ tenantId: req.tenantId }).select('name brand variants.sku variants.barcode').session(session).lean();
    const names = new Set(existing.map((product) => productImportKey(product.name, product.brand)));
    const skus = new Set(existing.flatMap((product) => product.variants.map((variant) => variant.sku?.toLowerCase()).filter(Boolean)));
    const barcodes = new Set(existing.flatMap((product) => product.variants.map((variant) => variant.barcode?.toLowerCase()).filter(Boolean)));
    const errors = [];
    for (const product of products) {
      if (names.has(productImportKey(product.name, product.brand))) errors.push({ row: product.rows[0], message: `${product.name}: product already exists. Imports create new products only.` });
      product.variants.forEach((variant, index) => {
        if ((variant.sku && skus.has(variant.sku.toLowerCase())) || (variant.barcode && barcodes.has(variant.barcode.toLowerCase()))) errors.push({ row: product.rows[index], message: 'SKU or barcode already exists in your store.' });
      });
    }
    if (errors.length) throw new AppError('Resolve duplicates before importing. No products were saved.', 409, errors);
    const summary = { productCount: products.length, variantCount: rowCount, preview: products.slice(0, 20).map((product) => ({ name: product.name, brand: product.brand, variantCount: product.variants.length })) };
    if (req.body.preview === 'true') return summary;
    const created = await Product.create(products.map(({ rows, ...product }) => product), { session, ordered: true });
    const ledger = created.flatMap((product) => product.variants.filter((variant) => variant.stock > 0).map((variant) => ({
      tenantId: req.tenantId, productId: product._id, variantId: variant._id,
      movementType: 'ADJUSTMENT_ADD', quantityChange: variant.stock, balanceBefore: 0, balanceAfter: variant.stock,
      referenceType: 'StockAdjustment', reason: 'manual_correction', note: 'Initial stock from Excel import', createdBy: req.user._id,
    })));
    if (ledger.length) await StockLedger.create(ledger, { session, ordered: true });
    return summary;
  });
  sendSuccess(res, result, req.body.preview === 'true' ? 200 : 201);
}));
