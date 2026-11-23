import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Input from '../../components/ui/Input';

export default function AuthPassword({ value, ...props }) {
  const [showPassword, setShowPassword] = useState(false);
  const toggleLabel = showPassword ? 'Hide password' : 'Show password';

  return (
    <Input
      {...props}
      name="password"
      label="Password"
      value={value}
      type={showPassword ? 'text' : 'password'}
      required
      rightIcon={(
        <button
          type="button"
          className="auth-toggle"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
        </button>
      )}
    />
  );
}
