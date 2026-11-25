import Supplier from '../models/Supplier.js';
import { AppError } from '../utils/AppError.js';
import { postSupplierPayment, supplierReconciliation } from '../services/supplierAccounting.service.js';
import { sendPaginated } from '../utils/response.js';
import { escapeRegex, parsePagination } from '../utils/query.js';

const WRITABLE_FIELDS = [
  'name', 'phone', 'email', 'companyName', 'address', 'gstNumber', 'notes', 'isActive',
];

const supplierPayload = (body) => Object.fromEntries(
  WRITABLE_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])
);

/* ─── List suppliers ─────────────────────────────────── */
export const getSuppliers = async (req, res, next) => {
  try {
    const { search, isActive } = req.query;
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 30, maxLimit: 100 });
    const filter = { tenantId: req.tenantId };
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      const regex = new RegExp(escapeRegex(String(search).trim().slice(0, 80)), 'i');
      filter.$or = [{ name: regex }, { phone: regex }, { companyName: regex }];
    }

    const [suppliers, total, [summary]] = await Promise.all([
      Supplier.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(limit).lean(),
      Supplier.countDocuments(filter),
      Supplier.aggregate([
        { $match: filter },
        { $group: { _id: null, totalDue: { $sum: '$pendingAmount' }, withDue: { $sum: { $cond: [{ $gt: ['$pendingAmount', 0] }, 1, 0] } } } },
      ]),
    ]);

    res.json({
      success: true,
      data: { suppliers, summary: { totalDue: summary?.totalDue || 0, withDue: summary?.withDue || 0 } },
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* ─── Get single supplier ────────────────────────────── */
export const getSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!supplier) return next(new AppError('Supplier not found', 404));
    res.json({ success: true, data: { supplier } });
  } catch (err) { next(err); }
};

/* ─── Create supplier ────────────────────────────────── */
export const createSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.create({ ...supplierPayload(req.body), tenantId: req.tenantId });
    res.status(201).json({ success: true, data: { supplier } });
  } catch (err) { next(err); }
};

/* ─── Update supplier ────────────────────────────────── */
export const updateSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { $set: supplierPayload(req.body) },
      { new: true, runValidators: true }
    );
    if (!supplier) return next(new AppError('Supplier not found', 404));
    res.json({ success: true, data: { supplier } });
  } catch (err) { next(err); }
};

/* ─── Delete supplier ────────────────────────────────── */
export const deleteSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!supplier) return next(new AppError('Supplier not found', 404));
    if (supplier.pendingAmount > 0) return next(new AppError('Cannot delete supplier with pending amount.', 400));
    supplier.isActive = false;
    await supplier.save();
    res.json({ success: true, message: 'Supplier archived.' });
  } catch (err) { next(err); }
};

/* ─── Record payment to supplier ─────────────────────── */
export const recordPayment = async (req, res, next) => {
  try {
    const { supplier, payment } = await postSupplierPayment({ req, supplierId: req.params.id });
    res.json({ success: true, data: { supplier, payment }, message: 'Payment recorded.' });
  } catch (err) { next(err); }
};

export const getSupplierReconciliation = async (req, res, next) => {
  try {
    if (!req.tenantId) throw new AppError('Tenant context required.', 403);
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const mismatches = await supplierReconciliation(req.tenantId, req.query.supplierId);
    sendPaginated(res, mismatches.slice(skip, skip + limit), mismatches.length, page, limit);
  } catch (err) { next(err); }
};
