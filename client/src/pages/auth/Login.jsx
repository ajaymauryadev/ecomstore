import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useLoginMutation } from '../../features/auth/authApi';
import Input from '../../components/ui/Input';
import { dashboardRouteForRole, ROUTES } from '../../constants/routes';
import AuthLayout, { AuthSubmit } from './AuthLayout';
import AuthPassword from './AuthPassword';
import { emailPattern, focusAuthError, getAuthErrors } from './authForm';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [login, { isLoading }] = useLoginMutation();
  const [form, setForm] = useState({ email: '', password: '', rememberMe: false });
  const [errors, setErrors] = useState({});

  const updateField = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined, form: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isLoading) return;

    const formElement = event.currentTarget;
    const values = { ...form, email: form.email.trim() };
    const nextErrors = {};
    if (!values.email) nextErrors.email = 'Email is required.';
    else if (!emailPattern.test(values.email)) nextErrors.email = 'Enter a valid email address.';
    if (!values.password) nextErrors.password = 'Password is required.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusAuthError(formElement, nextErrors);
      return;
    }

    try {
      const result = await login(values).unwrap();
      toast.success('Welcome back!');
      navigate(location.state?.from || dashboardRouteForRole(result?.data?.user?.role), { replace: true });
    } catch (error) {
      const nextErrors = getAuthErrors(error);
      setErrors(nextErrors);
      setForm((previous) => ({ ...previous, password: '' }));
      focusAuthError(formElement, nextErrors);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      description="Access your Smart Kirana workspace."
      alternate={{ prompt: 'New to Smart Kirana?', to: ROUTES.REGISTER, label: 'Create a store' }}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <Input
          name="email"
          label="Email Address"
          type="email"
          autoComplete="username"
          value={form.email}
          onChange={(event) => updateField('email', event.target.value)}
          error={errors.email}
          required
        />
        <AuthPassword
          autoComplete="current-password"
          value={form.password}
          onChange={(event) => updateField('password', event.target.value)}
          error={errors.password}
        />
        {errors.form && <p className="auth-error" role="alert">{errors.form}</p>}
        <label className="auth-remember">
          <input
            type="checkbox"
            name="rememberMe"
            checked={form.rememberMe}
            onChange={(event) => updateField('rememberMe', event.target.checked)}
          />
          Remember me
        </label>
        <AuthSubmit isLoading={isLoading} label="Sign in" pendingLabel="Signing in…" />
      </form>
    </AuthLayout>
  );
}
