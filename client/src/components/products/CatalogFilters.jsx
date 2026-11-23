import { useRef, useState } from 'react';
import { ArrowDownUp, Check, ChevronDown, PackageCheck, SlidersHorizontal, Sparkles, Tag, X } from 'lucide-react';
import Modal from '../ui/Modal';
import { cn } from '../../utils/cn';
import { useGetPublicProductsQuery } from '../../features/products/productApi';

const FLAGS = [
  { key: 'inStock', label: 'In stock', detail: 'Ready to add to your cart', icon: PackageCheck },
  { key: 'offer', label: 'Offers', detail: 'Find a little extra value', icon: Tag },
  { key: 'featured', label: 'Featured', detail: 'Picks from your store', icon: Sparkles },
];
const SORTS = [
  ['recommended', 'Recommended', 'Featured picks first'], ['price_asc', 'Price: Low to high', 'Start with the best value'],
  ['price_desc', 'Price: High to low', 'Explore premium picks'], ['newest', 'Newest first', 'Recently added to the store'],
  ['name', 'Name: A to Z', 'Find products alphabetically'],
];

export default function CatalogFilters({ params, onChange, categories, storeSlug }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [categorySearch, setCategorySearch] = useState('');
  const sortRef = useRef(null);
  const filtersRef = useRef(null);
  const [mode, setMode] = useState('filters');
  const sort = SORTS.find(([key]) => key === params.get('sort')) || SORTS[0];
  const count = FLAGS.filter(({ key }) => params.get(key) === 'true').length + Number(Boolean(params.get('cat')));
  const query = { slug: storeSlug, limit: 1, ...(params.get('q') && { search: params.get('q') }),
    ...(draft.cat && { categoryId: draft.cat }), ...Object.fromEntries(FLAGS.filter(({ key }) => draft[key]).map(({ key }) => [key, 'true'])) };
  const { currentData, isFetching, isError } = useGetPublicProductsQuery(query, { skip: !open });
  const edit = (nextMode) => {
    setDraft({ cat: params.get('cat') || '', sort: sort[0], ...Object.fromEntries(FLAGS.map(({ key }) => [key, params.get(key) === 'true'])) });
    setCategorySearch(''); setMode(nextMode); setOpen(true);
  };
  const toggleQuickFilter = (key) => {
    const next = new URLSearchParams(params);
    if (next.get(key) === 'true') next.delete(key); else next.set(key, 'true');
    onChange(next);
  };
  const apply = (event) => {
    event.preventDefault();
    const next = new URLSearchParams(params);
    for (const { key } of FLAGS) { if (draft[key]) next.set(key, 'true'); else next.delete(key); }
    if (draft.cat) next.set('cat', draft.cat); else next.delete('cat');
    if (draft.sort !== 'recommended') next.set('sort', draft.sort); else next.delete('sort');
    onChange(next); setOpen(false);
  };
  const sortControls = <fieldset className="filter-sheet-section"><legend>Sort by</legend>
    <div className="sort-choice-list">{SORTS.map(([key, label, detail], index) => <label key={key} className={cn('sort-choice', draft.sort === key && 'is-selected')}>
      <input ref={index === 0 ? sortRef : undefined} type="radio" name="catalog-sort" value={key} checked={draft.sort === key}
        onChange={() => setDraft((value) => ({ ...value, sort: key }))} />
      <span><strong>{label}</strong><small>{detail}</small></span>
      {draft.sort === key && <Check size={17} aria-hidden="true" />}
    </label>)}</div>
  </fieldset>;

  return <>
    <div className="catalog-toolbar" role="group" aria-label="Product filters">
      <button type="button" className={cn('catalog-control', count > 0 && 'has-filters')} aria-label={`Filters${count ? ` (${count} active)` : ''}`}
        onClick={() => edit('filters')} aria-haspopup="dialog"><SlidersHorizontal size={16} aria-hidden="true" /> Filters
        {count > 0 && <span className="catalog-filter-count">{count}</span>}</button>
      <button type="button" onClick={() => edit('sort')} className="catalog-control catalog-sort-trigger" aria-label={`Sort products: ${sort[1]}`} aria-haspopup="dialog">
        <ArrowDownUp size={16} aria-hidden="true" /><span>{sort[1]}</span><ChevronDown size={13} aria-hidden="true" />
      </button>
      <span className="catalog-toolbar-divider" aria-hidden="true" />
      {FLAGS.map(({ key, label, icon: Icon }) => <button key={key} type="button" aria-pressed={params.get(key) === 'true'}
        onClick={() => toggleQuickFilter(key)} className={cn('catalog-control catalog-quick-filter', params.get(key) === 'true' && 'is-selected')}>
        <Icon size={14} aria-hidden="true" />{label}{params.get(key) === 'true' && <Check size={13} aria-hidden="true" />}
      </button>)}
    </div>
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Filters & sort" size="lg" closeLabel="Close filters"
      className="catalog-sheet catalog-filter-sheet" initialFocusRef={mode === 'sort' ? sortRef : filtersRef}>
      <form onSubmit={apply} className="filter-sheet-form">
        <div className="filter-sheet-body">
          <p className="filter-sheet-intro">Make it easier to find your next favourite.</p>
          {mode === 'sort' && sortControls}
          <fieldset className="filter-sheet-section"><legend>Shopping preferences</legend>
            <div className="filter-preferences">{FLAGS.map(({ key, label, detail, icon: Icon }, index) => <label key={key}
              className={cn('filter-preference', draft[key] && 'is-selected')}>
              <span className="filter-preference-icon"><Icon size={19} aria-hidden="true" /></span>
              <span><strong>{label}</strong><small>{detail}</small></span>
              <input ref={index === 0 ? filtersRef : undefined} type="checkbox" checked={Boolean(draft[key])}
                onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.checked }))} />
            </label>)}</div>
          </fieldset>
          <fieldset className="filter-sheet-section"><legend>Category</legend>
            <input type="search" aria-label="Find filter category" placeholder="Search category names…" value={categorySearch}
              onChange={(event) => setCategorySearch(event.target.value)} className="input w-full mb-3" />
            <div className="filter-category-list">
              <label className={cn('filter-category-option', !draft.cat && 'is-selected')}><input type="radio" name="filter-category" checked={!draft.cat}
                onChange={() => setDraft((value) => ({ ...value, cat: '' }))} />All categories</label>
              {categories.filter((category) => category.name.toLocaleLowerCase().includes(categorySearch.trim().toLocaleLowerCase())).map((category) => (
                <label key={category._id} className={cn('filter-category-option', draft.cat === category._id && 'is-selected')}>
                  <input type="radio" name="filter-category" checked={draft.cat === category._id} onChange={() => setDraft((value) => ({ ...value, cat: category._id }))} />
                  <span aria-hidden="true">{category.emoji}</span><span>{category.name}</span>
                </label>
              ))}
              {categorySearch.trim() && !categories.some((category) => category.name.toLocaleLowerCase().includes(categorySearch.trim().toLocaleLowerCase()))
                && <p role="status" className="text-sm text-slate-500 py-3">No matching categories.</p>}
            </div>
          </fieldset>
          {mode !== 'sort' && sortControls}
        </div>
        <div className="filter-sheet-footer">
          <button type="button" className="filter-reset" onClick={() => setDraft({ cat: '', sort: 'recommended' })}><X size={14} aria-hidden="true" /> Reset</button>
          <button type="submit" className="btn btn-primary" aria-label="Apply filters">
            {isFetching ? 'Updating results…' : isError || !currentData ? 'Apply filters' : `Show ${currentData.meta?.total ?? 0} results`}
          </button>
        </div>
      </form>
    </Modal>
  </>;
}
