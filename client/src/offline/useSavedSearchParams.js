import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSavedViewState } from './useSavedViewState';

export function useSavedSearchParams() {
  const [saved, setSaved] = useSavedViewState('catalog-search-params', '');
  const [params, setParams] = useSearchParams(saved);
  useEffect(() => { setSaved(params.toString()); }, [params, setSaved]);
  const update = (value, options) => {
    const next = new URLSearchParams(typeof value === 'function' ? value(params) : value);
    setSaved(next.toString());
    setParams(next, options);
  };
  return [params, update];
}
