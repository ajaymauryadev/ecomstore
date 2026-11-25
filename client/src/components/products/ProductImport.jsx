import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { useImportProductsMutation, useDownloadProductSampleMutation } from '../../features/products/productApi';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

export default function ProductImport({ onImported }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [failure, setFailure] = useState(null);
  const [importProducts, { isLoading }] = useImportProductsMutation();
  const [downloadSample, { isLoading: downloading }] = useDownloadProductSampleMutation();
  const download = async () => {
    try { await downloadSample().unwrap(); } catch (error) { toast.error(error?.data?.message || 'Sample download failed.'); }
  };
  const submit = async (previewOnly) => {
    if (!file) return;
    setFailure(null);
    const body = new FormData();
    body.append('file', file);
    body.append('preview', String(previewOnly));
    try {
      const result = await importProducts(body).unwrap();
      if (previewOnly) setPreview(result.data);
      else {
        toast.success(`Imported ${result.data.productCount} products and ${result.data.variantCount} variants.`);
        setOpen(false); setFile(null); setPreview(null); onImported?.();
      }
    } catch (error) { setPreview(null); setFailure(error?.data || { message: 'Upload failed. Please try again.' }); }
  };
  return <>
    <Button size="sm" variant="secondary" leftIcon={<Download size={14} />} isLoading={downloading} onClick={download}>Download Sample</Button>
    <Button size="sm" variant="secondary" leftIcon={<Upload size={14} />} onClick={() => setOpen(true)}>Import Excel</Button>
    <Modal isOpen={open} onClose={() => { if (!isLoading) setOpen(false); }} title="Import products from Excel" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Download the sample, replace its examples, and upload an .xlsx file. Use one row per variant and repeat the product name and brand. Up to 500 rows, 2 MB. Imports create new products.</p>
        <button type="button" className="workspace-link" disabled={downloading} onClick={download}>Download sample workbook</button>
        <label className="block text-sm space-y-2"><span>Excel workbook (.xlsx)</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={isLoading} className="input w-full" onChange={(event) => {
          const selected = event.target.files?.[0];
          setPreview(null); setFailure(null); setFile(null);
          if (!selected) return;
          if (!/\.xlsx$/i.test(selected.name) || selected.size > 2 * 1024 * 1024) { setFailure({ message: 'Choose an .xlsx file no larger than 2 MB.' }); return; }
          setFile(selected);
        }} /></label>
        {failure && <div role="alert" className="rounded-xl border border-red-500/30 p-3 text-sm text-red-400"><p>{failure.message}</p>{failure.errors?.length > 0 && <ul className="mt-2 list-disc pl-5 max-h-56 overflow-auto">{failure.errors.map((error, index) => <li key={index}>{error.row ? `Row ${error.row}: ` : ''}{error.message}</li>)}</ul>}</div>}
        {preview && <div className="rounded-xl border border-navy-700 p-3 space-y-2" aria-live="polite"><p className="font-semibold">Ready to import {preview.productCount} products with {preview.variantCount} variants</p><ul className="text-sm text-slate-400 max-h-56 overflow-auto">{preview.preview.map((product, index) => <li key={index}>{product.name}{product.brand ? ` · ${product.brand}` : ''} — {product.variantCount} variant(s)</li>)}</ul>{preview.productCount > 20 && <p className="text-xs text-slate-500">Showing the first 20 products.</p>}<p className="text-xs text-slate-500">All rows are validated together. Opening stock will be recorded in the stock ledger.</p></div>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={isLoading} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!file} isLoading={isLoading} onClick={() => submit(!preview)}>{preview ? 'Import products' : 'Validate workbook'}</Button></div>
      </div>
    </Modal>
  </>;
}
