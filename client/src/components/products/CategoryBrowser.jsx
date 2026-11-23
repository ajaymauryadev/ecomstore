import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Search, X, ChevronRight, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';
import Modal from '../ui/Modal';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

function CategoryTile({ category, selected, onSelect }) {
  const [failedImage, setFailedImage] = useState(null);
  const image = category.image?.startsWith('/') ? `${API_BASE}${category.image}` : category.image;
  return <button type="button" aria-pressed={selected} onClick={() => onSelect(category._id)}
    className={cn('category-tile', selected && 'is-selected')}>
    <span className="category-tile-art" aria-hidden="true">
      {image && failedImage !== image
        ? <img src={image} alt="" loading="lazy" onError={() => setFailedImage(image)} />
        : <span>{category.emoji || '📦'}</span>}
      <span className="category-tile-arrow"><ArrowUpRight size={13} /></span>
    </span>
    <span className="category-tile-name">{category.name}</span>
  </button>;
}

export default function CategoryBrowser({ categories, activeId, onSelect, loading, error, onRetry, storeSlug, storeName }) {
  const [query, setQuery] = useState('');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const searchRef = useRef(null);
  const directorySearchRef = useRef(null);
  const tabsRef = useRef(null);
  const { groups, categoryGroups } = useMemo(() => {
    const byId = new Map(categories.map((category) => [category._id, category]));
    const roots = new Map();
    const categoryGroups = new Map();
    for (const category of categories) {
      let root = category;
      const visited = new Set([root._id]);
      while (byId.has(root.parentId) && !visited.has(root.parentId)) {
        root = byId.get(root.parentId);
        visited.add(root._id);
      }
      categoryGroups.set(category._id, root._id);
      roots.set(root._id, root);
    }
    return { groups: roots, categoryGroups };
  }, [categories]);
  const groupId = categoryGroups.get(activeId);
  const group = groups.get(groupId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = categories.filter((category) => {
    const rootId = categoryGroups.get(category._id);
    return (!group || rootId === group._id)
      && `${category.name} ${groups.get(rootId)?.name || ''}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  useEffect(() => {
    const rail = tabsRef.current;
    const activeTab = rail?.querySelector('[aria-pressed="true"]');
    if (activeTab) rail.scrollTo({ left: Math.max(0, activeTab.offsetLeft - rail.offsetLeft - 16) });
  }, [groupId]);

  const selectCategory = (id) => { onSelect(id); setDirectoryOpen(false); };
  const renderSearch = (ref) => <div className="category-search-field">
    <Search size={17} aria-hidden="true" />
    <input ref={ref} type="search" aria-label="Search categories" placeholder="Find a category…" value={query}
      onChange={(event) => setQuery(event.target.value)} />
    {query && <button type="button" aria-label="Clear category search" onClick={() => setQuery('')}><X size={16} /></button>}
  </div>;
  const renderTiles = (items, directory = false) => <div className={directory ? 'category-directory-grid' : 'category-rail'}>
    {items.map((category) => <CategoryTile key={category._id} category={category} selected={activeId === category._id} onSelect={selectCategory} />)}
  </div>;
  const renderState = () => loading ? <div className="category-rail" aria-label="Loading categories">
    {Array.from({ length: 4 }, (_, index) => <div key={index} className="category-placeholder animate-pulse" />)}
  </div> : error ? <div role="alert" className="text-sm text-slate-400 py-4">
    Categories could not be loaded. <button type="button" onClick={onRetry} className="min-h-11 text-gold-400 underline">Try again</button>
  </div> : !matches.length ? <p role="status" className="py-6 text-sm text-slate-500">
    {categories.length ? `No categories match “${query.trim()}”. Try another name or choose All.` : 'Categories will appear here when the store adds them.'}
  </p> : null;

  return <section aria-label="Browse categories" className="category-browser">
    <div className="category-masthead">
      <div className="category-heading-row">
        <Link to={`/s/${storeSlug}`} aria-label="Back to store" className="category-round-button"><ArrowLeft size={20} /></Link>
        <div><p className="category-eyebrow">{storeName || 'Your local store'}</p><h1>All Categories</h1></div>
        <button type="button" aria-label="Find a category" className="category-round-button" onClick={() => searchRef.current?.focus()}><Search size={20} /></button>
      </div>
      <div ref={tabsRef} className="category-tabs" role="group" aria-label="Category groups">
        <button type="button" aria-pressed={!group} onClick={() => onSelect('all')}>All</button>
        {[...groups.values()].map((item) => <button type="button" key={item._id} aria-pressed={groupId === item._id}
          onClick={() => onSelect(item._id)}>{item.name}</button>)}
      </div>
    </div>
    <div className="category-browser-body">
      {renderSearch(searchRef)}
      <div className="category-section-heading"><div><h2>{group?.name || 'Shop by category'}</h2>
        <p>{loading ? 'Loading categories…' : `${categories.length} categories to explore`}</p></div>
        <button type="button" aria-label={`View all ${categories.length} categories`} onClick={() => setDirectoryOpen(true)}>
          View all <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      {renderState() || renderTiles(matches.slice(0, 12))}
    </div>
    <Modal isOpen={directoryOpen} onClose={() => setDirectoryOpen(false)} title="Explore categories" size="lg"
      className="catalog-sheet category-directory" initialFocusRef={directorySearchRef} closeLabel="Close categories">
      <div className="category-directory-search">{renderSearch(directorySearchRef)}
        {group && <button type="button" onClick={() => onSelect('all')} className="category-all mt-2"><LayoutGrid size={14} /> All groups</button>}
      </div>
      <p role="status" className="text-xs text-slate-500 my-3">{matches.length} categories</p>
      {renderState() || renderTiles(matches, true)}
    </Modal>
  </section>;
}
