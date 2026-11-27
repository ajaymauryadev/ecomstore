import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

export default function CategoryArtwork({ category }) {
  const [failed, setFailed] = useState(null);
  const image = category.image?.startsWith('/') ? `${API_BASE}${category.image}` : category.image;
  return image && failed !== image
    ? <img src={image} alt="" loading="lazy" decoding="async" width="96" height="96" onError={() => setFailed(image)} />
    : <span>{category.emoji || '🛍️'}</span>;
}
