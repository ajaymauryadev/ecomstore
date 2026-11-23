import { ArrowRight, Boxes, ClipboardList, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import './auth.css';

export default function AuthLayout({ title, description, alternate, brandName = 'Smart Kirana', brandContent, children }) {
  return (
    <div className="auth-layout">
      <header className="auth-brand">
        <div className="auth-wordmark">
          <span className="auth-mark"><Store size={22} aria-hidden="true" /></span>
          {brandName}
        </div>
        <div className="auth-brand-content">
          {brandContent ?? (
            <>
              <p className="auth-brand-title">Run your kirana<br />in one place.</p>
              <ul className="auth-features">
                <li><ClipboardList size={18} aria-hidden="true" /> Billing and POS</li>
                <li><Boxes size={18} aria-hidden="true" /> Stock management</li>
                <li><Store size={18} aria-hidden="true" /> Online storefront</li>
              </ul>
            </>
          )}
        </div>
      </header>

      <main className="auth-main" tabIndex={-1} aria-label={title}>
        <div className="auth-content">
          <div className="auth-intro">
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
          {alternate && (
            <p className="auth-alternate">
              {alternate.prompt}{' '}
              <Link to={alternate.to}>{alternate.label}</Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export function AuthSubmit({ isLoading, label, pendingLabel }) {
  return (
    <>
      <Button
        type="submit"
        fullWidth
        isLoading={isLoading}
        rightIcon={<ArrowRight size={18} aria-hidden="true" />}
        className="auth-submit"
      >
        {isLoading ? pendingLabel : label}
      </Button>
      <span className="sr-only" role="status">{isLoading ? pendingLabel : ''}</span>
    </>
  );
}
