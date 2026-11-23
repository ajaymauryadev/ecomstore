import { cn } from '../../utils/cn';
import Spinner from './Spinner';

const variants = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  outline: 'btn border border-navy-600 hover:border-gold-500/50 text-slate-300 hover:text-gold-400',
};

const sizes = {
  xs: 'px-2.5 py-1 text-xs rounded-lg',
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
  xl: 'px-8 py-4 text-base',
  icon: 'p-2.5 rounded-xl',
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  ...props
}) {
  return (
    <button
      className={cn(
        'btn',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
      disabled={isLoading || props.disabled}
    >
      {isLoading ? (
        <Spinner size="sm" className="text-current" />
      ) : leftIcon ? (
        <span className="shrink-0">{leftIcon}</span>
      ) : null}
      {children && <span>{children}</span>}
      {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
}
