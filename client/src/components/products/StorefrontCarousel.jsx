import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Leaf, Milk, Package, Pause, Play, ShoppingBag, Wheat } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

export default function StorefrontCarousel({ store, storeSlug }) {
  const track = useRef(null);
  const frame = useRef(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const base = `/s/${storeSlug}`;
  const slides = [
    { tag: 'YOUR NEIGHBOURHOOD STORE', title: 'Everyday essentials, closer to home.',
      copy: store?.branding?.tagline || `A little of everything you need, from ${store?.name || 'your local store'}.`,
      action: 'Explore the store', to: `${base}/categories`, tone: 'everyday', Icon: ShoppingBag },
    { tag: 'A LITTLE MORE VALUE', title: 'Good finds. Great everyday value.',
      copy: 'Explore products with current offers. Your next favourite could be here.',
      action: 'Explore offers', to: `${base}?offer=true`, tone: 'offers', Icon: Package },
    { tag: 'FIND YOUR FAVOURITES', title: 'Your shopping list, made simple.',
      copy: 'From pantry staples to daily essentials. Find it all, aisle by aisle.',
      action: 'Browse categories', to: `${base}/categories`, tone: 'categories', Icon: Leaf },
  ];

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReducedMotion(media.matches);
    const visibility = () => setVisible(document.visibilityState !== 'hidden');
    motion();
    let inView = true;
    const updateVisibility = () => setVisible(inView && document.visibilityState !== 'hidden');
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      updateVisibility();
    }, { threshold: 0.25 }) : null;
    observer?.observe(track.current);
    visibility();
    document.addEventListener('visibilitychange', updateVisibility);
    media.addEventListener('change', motion);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
      media.removeEventListener('change', motion);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const goTo = (index) => {
    track.current?.scrollTo({ left: track.current.clientWidth * index, behavior: reducedMotion ? 'instant' : 'smooth' });
    setActive(index);
  };
  useEffect(() => {
    if (paused || interacting || !visible || reducedMotion) return;
    const timer = window.setTimeout(() => {
      const next = (active + 1) % 3;
      track.current?.scrollTo({ left: track.current.clientWidth * next, behavior: 'smooth' });
      setActive(next);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [active, paused, interacting, visible, reducedMotion]);

  return <section className="shop-carousel" aria-label="Store highlights" aria-roledescription="carousel"
    onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)}
    onFocusCapture={() => setInteracting(true)} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false);
    }}>
    <div ref={track} className="shop-carousel-track" onScroll={() => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (track.current) setActive(Math.round(track.current.scrollLeft / track.current.clientWidth));
      });
    }}>
      {slides.map(({ tag, title, copy, action, to, tone, Icon }, index) => <article key={tone}
        className={`shop-slide shop-slide-${tone}`} aria-roledescription="slide" aria-label={`${index + 1} of 3`}
        inert={active !== index ? '' : undefined}>
        <div className="shop-slide-copy"><span className="shop-slide-eyebrow"><span />{tag}</span>
          {index === 0 ? <h1>{title}</h1> : <h2>{title}</h2>}
          <p>{copy}</p>
          <Link to={to} tabIndex={active === index ? 0 : -1}>{action}<ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
        {index === 0 && store?.branding?.banner ? <div className="shop-slide-image"><img
          src={store.branding.banner.startsWith('/') ? `${API_BASE}${store.branding.banner}` : store.branding.banner}
          alt="" decoding="async" /></div> : <div className="shop-slide-art" aria-hidden="true">
          <div className="shop-art-orbit" /><span className="shop-art-spark">✦</span>
          <div className="shop-art-item shop-art-item-one"><Milk strokeWidth={1.25} /></div>
          <div className="shop-art-item shop-art-item-two"><Wheat strokeWidth={1.25} /></div>
          <div className="shop-art-bag"><Icon strokeWidth={1.25} /><span>LOCAL FINDS</span></div>
          <div className="shop-art-leaf"><Leaf size={20} strokeWidth={1.5} /></div>
        </div>}
      </article>)}
    </div>
    <div className="shop-carousel-controls"><span className="shop-carousel-caption">Small store. Everyday possibilities.</span>
      <div className="shop-carousel-dots">{slides.map((slide, index) => <button key={slide.tone} type="button"
        aria-label={`Show highlight ${index + 1}`} aria-current={active === index ? 'true' : undefined}
        onClick={() => goTo(index)}><span /></button>)}</div>
      {!reducedMotion && <button type="button" className="shop-carousel-pause" aria-label={paused ? 'Play highlights' : 'Pause highlights'}
        onClick={() => setPaused((value) => !value)}>{paused ? <Play size={12} /> : <Pause size={12} />}</button>}
    </div>
  </section>;
}
