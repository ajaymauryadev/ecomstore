import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useRegisterMutation } from '../../features/auth/authApi';
import Input from '../../components/ui/Input';
import { slugify } from '../../utils/formatters';
import { dashboardRouteForRole, ROUTES } from '../../constants/routes';
import AuthLayout, { AuthSubmit } from './AuthLayout';
import AuthPassword from './AuthPassword';
import { emailPattern, focusAuthError, getAuthErrors } from './authForm';

const passwordRule = 'Use 10 to 128 characters.';

function validateRegistration(values) {
  const errors = {};
  if (!values.storeName) errors.storeName = 'Store name is required.';
  else if (values.storeName.length > 100) errors.storeName = 'Use 100 characters or fewer.';
  if (!values.storeSlug) errors.storeSlug = 'Store URL is required.';
  else if (!/^[a-z0-9-]+$/.test(values.storeSlug)) errors.storeSlug = 'Use only lowercase letters, numbers and hyphens.';
  else if (values.storeSlug.length < 3 || values.storeSlug.length > 50) errors.storeSlug = 'Use 3 to 50 characters.';
  if (!values.name) errors.name = 'Full name is required.';
  else if (values.name.length > 80) errors.name = 'Use 80 characters or fewer.';
  if (!values.email) errors.email = 'Email is required.';
  else if (!emailPattern.test(values.email)) errors.email = 'Enter a valid email address.';
  if (values.phone && !/^[6-9]\d{9}$/.test(values.phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
  if (values.password.length < 10 || values.password.length > 128) errors.password = passwordRule;
  return errors;
}

export default function Register() {
  const navigate = useNavigate();
  const [register, { isLoading }] = useRegisterMutation();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    storeName: '',
    storeSlug: '',
    role: 'store_owner',
  });
  const [errors, setErrors] = useState({});
  const [slugManual, setSlugManual] = useState(false);

  const updateField = (field, value) => {
    const update = { [field]: value };
    const clearedErrors = { [field]: undefined, form: undefined };
    if (field === 'storeName' && !slugManual) {
      update.storeSlug = slugify(value);
      clearedErrors.storeSlug = undefined;
    }
    setForm((previous) => ({ ...previous, ...update }));
    setErrors((previous) => ({ ...previous, ...clearedErrors }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isLoading) return;

    const formElement = event.currentTarget;
    const values = {
      ...form,
      storeName: form.storeName.trim(),
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone || undefined,
    };
    const nextErrors = validateRegistration(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusAuthError(formElement, nextErrors);
      return;
    }

    try {
      const result = await register(values).unwrap();
      toast.success('Store created! Welcome to Smart Kirana.');
      navigate(dashboardRouteForRole(result?.data?.user?.role), { replace: true });
    } catch (error) {
      const nextErrors = getAuthErrors(error, true);
      setErrors(nextErrors);
      setForm((previous) => ({ ...previous, password: '' }));
      focusAuthError(formElement, nextErrors);
    }
  };

  return (
    <AuthLayout
      title="Create your store"
      description="Start your 30-day free trial."
      alternate={{ prompt: 'Already have an account?', to: ROUTES.LOGIN, label: 'Sign in' }}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="auth-group">
          <legend>Store Details</legend>
          <Input
            name="storeName"
            label="Store Name"
            autoComplete="organization"
            value={form.storeName}
            onChange={(event) => updateField('storeName', event.target.value)}
            error={errors.storeName}
            required
          />
          <Input
            name="storeSlug"
            label="Store URL"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={form.storeSlug}
            onChange={(event) => {
              setSlugManual(true);
              updateField('storeSlug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
            }}
            error={errors.storeSlug}
            aria-describedby="store-url-preview"
            required
          />
          <p id="store-url-preview" className="auth-slug">
            <span>Preview</span> {ROUTES.STOREFRONT(form.storeSlug || 'your-store')}
          </p>
        </fieldset>
        <fieldset className="auth-group auth-account">
          <legend>Your Account</legend>
          <div className="auth-account-fields">
            <Input
              name="name"
              label="Full Name"
              autoComplete="name"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              error={errors.name}
              required
            />
            <Input
              name="email"
              label="Email Address"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => updateField('email', event.target.value)}
              error={errors.email}
              required
            />
          </div>
          <Input
            name="phone"
            label="Mobile Number"
            type="tel"
            autoComplete="tel-national"
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
            error={errors.phone}
            hint="Optional · 10-digit Indian mobile number"
          />
          <AuthPassword
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => updateField('password', event.target.value)}
            error={errors.password}
            hint={passwordRule}
          />
        </fieldset>
        {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
        <AuthSubmit isLoading={isLoading} label="Create store" pendingLabel="Creating store…" />
      </form>
    </AuthLayout>
  );
}
