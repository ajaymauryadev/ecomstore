import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Package, ShoppingBag, Tag } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';
import './storefront-carousel.css';

const SLIDE_COUNT = 3;
const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

export default function StorefrontCarousel({ store, storeSlug }) {
  const track = useRef(null);
  const frame = useRef(null);
  const [active, setActive] = useState(0);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const moveTo = (index) => {
    const node = track.current;
    if (!node) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollTo({ left: Math.max(0, Math.min(SLIDE_COUNT - 1, index)) * node.clientWidth,
      behavior: reducedMotion ? 'auto' : 'smooth' });
  };
  const onScroll = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const node = track.current;
      if (node?.clientWidth) setActive(Math.max(0, Math.min(SLIDE_COUNT - 1, Math.round(node.scrollLeft / node.clientWidth))));
    });
  };

  const root = `/s/${storeSlug}`;
  const banner = store?.branding?.banner;
  const bannerSrc = banner?.startsWith('/') ? `${API_BASE}${banner}` : banner;
  const slides = [
    { label: 'Local shopping', title: `Welcome to ${store?.name || 'the store'}`,
      description: store?.branding?.tagline || 'Your everyday essentials, close to home. Browse current products, prices, and stock.',
      action: 'Browse categories', to: `${root}/categories`, icon: ShoppingBag, theme: 'welcome' },
    { label: 'Discover offers', title: 'More value in your everyday basket',
      description: 'Explore products with current offers. See the latest prices before you add to your cart.',
      action: 'Explore offers', to: `${root}?offer=true`, icon: Tag, theme: 'offers' },
    { label: 'Shop your way', title: 'Find your favourites, with less searching',
      description: 'From daily essentials to your next grocery list, browse everything by category.',
      action: 'Find your essentials', to: `${root}/categories`, icon: Package, theme: 'essentials' },
  ];

  return (
    <section className="storefront-carousel" role="region" aria-roledescription="carousel" aria-label="Store highlights">
      <div ref={track} className="storefront-carousel-track" onScroll={onScroll} tabIndex={0}
        aria-label="Swipe or use the arrow keys to browse store highlights"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            moveTo(active + (event.key === 'ArrowLeft' ? -1 : 1));
          }
        }}>
        {slides.map(({ label, title, description, action, to, icon: Icon, theme }, index) => (
          <div key={theme} className={`storefront-carousel-slide storefront-carousel-${theme}`}
            role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${SLIDE_COUNT}`}
            aria-hidden={index !== active}>
            <div className="storefront-carousel-copy">
              <p className="storefront-carousel-eyebrow">{label}</p>
              {index === 0 ? <h1>{title}</h1> : <h2>{title}</h2>}
              <p className="storefront-carousel-description">{description}</p>
              {index === 0 && store?.deliverySettings?.freeDeliveryAbove > 0 && (
                <p className="storefront-carousel-delivery">Free delivery above {formatCurrency(store.deliverySettings.freeDeliveryAbove)}</p>
              )}
              <Link to={to} tabIndex={index === active ? 0 : -1} className="storefront-carousel-link">
                {action} <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div className="storefront-carousel-art" aria-hidden="true">
              {index === 0 && bannerSrc ? <img src={bannerSrc} alt="" width="480" height="360" decoding="async" loading="lazy" /> : <>
                <span className="storefront-carousel-orbit" />
                <span className="storefront-carousel-icon"><Icon strokeWidth={1.25} /></span>
                <span className="storefront-carousel-spark storefront-carousel-spark-one" />
                <span className="storefront-carousel-spark storefront-carousel-spark-two" />
              </>}
            </div>
          </div>
        ))}
      </div>
      <div className="storefront-carousel-controls">
        <button type="button" onClick={() => moveTo(active - 1)} disabled={active === 0} aria-label="Previous highlight">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div className="storefront-carousel-dots" role="group" aria-label="Choose a highlight">
          {slides.map(({ label }, index) => <button key={label} type="button" aria-label={`Show highlight ${index + 1}: ${label}`}
            aria-current={index === active ? 'true' : undefined} onClick={() => moveTo(index)}><span /></button>)}
        </div>
        <button type="button" onClick={() => moveTo(active + 1)} disabled={active === SLIDE_COUNT - 1} aria-label="Next highlight">
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
