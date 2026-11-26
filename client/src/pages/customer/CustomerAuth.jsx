import { useState } from 'react';
import { useNavigate, useParams, useLocation, useOutletContext, Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Phone, Lock, User, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { setCredentials } from '../../features/auth/authSlice';
import { useCustomerRegisterMutation, useCustomerLoginMutation } from '../../features/customer/customerApi';
import AuthLayout, { AuthSubmit } from '../auth/AuthLayout';
import { transferGuestCart } from '../../features/cart/cartDraftStorage';
import Input from '../../components/ui/Input';
import { cn } from '../../utils/cn';
import toast from 'react-hot-toast';

export default function CustomerAuth() {
  const { storeSlug } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { store } = useOutletContext();
  const { state } = useLocation();
  const cart = useSelector((appState) => appState.cart);
  const fromCheckout = state?.checkout === true;

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', password: '' });

  const [login, { isLoading: isLoggingIn }] = useCustomerLoginMutation();
  const [register, { isLoading: isRegistering }] = useCustomerRegisterMutation();
  const isLoading = isLoggingIn || isRegistering;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    if (mode === 'register' && !form.name.trim()) return 'Name is required';
    if (!form.phone || !/^[6-9]\d{9}$/.test(form.phone)) return 'Enter a valid 10-digit mobile number';
    if (form.password.length < 10) return 'Password must be at least 10 characters';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) return toast.error(err);

    try {
      const fn = mode === 'login' ? login : register;
      const res = await fn({ slug: storeSlug, ...form }).unwrap();
      if (fromCheckout) transferGuestCart(cart, res.data.store._id, res.data.user._id);
      dispatch(setCredentials({ user: res.data.user, accessToken: res.data.accessToken, store: res.data.store }));
      toast.success(mode === 'login' ? 'Welcome back! 👋' : 'Account created! 🎉');
      navigate(`/s/${storeSlug}${fromCheckout ? '/checkout' : state?.notifications ? '/notifications' : ''}`, { replace: true, state: fromCheckout && state?.buyNow ? { buyNow: state.buyNow } : undefined });
    } catch (err) {
      toast.error(err?.data?.message || 'Something went wrong');
    }
  };

  return (
    <AuthLayout
      title={mode === 'login' ? 'Sign in' : 'Create account'}
      description={fromCheckout ? 'Sign in or create an account to continue to checkout.' : 'Track your orders and save delivery addresses.'}
      brandName={store.name}
      brandContent={<p className="auth-brand-title">Shop your local store.</p>}
    >
      <Link to={`/s/${storeSlug}`} className="flex items-center gap-2 mb-4 text-sm font-medium text-[var(--auth-blue)]">
        <ArrowLeft size={15} aria-hidden="true" /> Back to store
      </Link>
      {/* Tabs */}
      <div className="flex mb-5 bg-[var(--brand-tint)] rounded-xl p-1" role="tablist" aria-label="Account action">
        {['login', 'register'].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            role="tab"
            aria-selected={mode === m}
            className={cn(
              'flex-1 py-2 text-sm font-semibold rounded-lg transition-all',
              mode === m ? 'bg-[var(--auth-blue)] text-white' : 'text-[var(--auth-muted)] hover:text-[var(--auth-ink)]'
            )}
          >
            {m === 'login' ? 'Login' : 'Register'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        {mode === 'register' && (
          <Input
              label="Full name"
              name="name"
              type="text"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              leftIcon={<User size={15} />}
              autoComplete="name"
              required
              autoFocus
          />
        )}

        <Input
            label="Mobile number"
            name="phone"
            type="tel"
            placeholder="10-digit mobile number"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            leftIcon={<Phone size={15} />}
            inputMode="numeric"
            autoComplete="tel"
            required
            autoFocus={mode === 'login'}
            maxLength={10}
        />

        <Input
            label="Password"
            name="password"
            type={showPass ? 'text' : 'password'}
            placeholder="Minimum 10 characters"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            leftIcon={<Lock size={15} />}
            minLength={10}
            maxLength={128}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            rightIcon={(
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                title={showPass ? 'Hide password' : 'Show password'}
                className="w-11 h-11 flex items-center justify-center auth-toggle transition-colors"
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
        />

        <AuthSubmit
          isLoading={isLoading}
          label={mode === 'login' ? 'Sign in' : 'Create account'}
          pendingLabel={mode === 'login' ? 'Signing in…' : 'Creating account…'}
        />
      </form>

    </AuthLayout>
  );
}
