import { forwardRef, useId } from 'react';
import { cn } from '../../utils/cn';

const Input = forwardRef(function Input(
  {
    id,
    name,
    label,
    error,
    hint,
    leftIcon,
    rightIcon,
    className,
    wrapperClassName,
    required,
    'aria-describedby': ariaDescribedBy,
    ...props
  },
  ref
) {
  const reactId = useId().replace(/:/g, '');
  const inputId = id || `input-${reactId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [ariaDescribedBy, error ? errorId : null, !error && hint ? hintId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-300">
          {label}
          {required && <span aria-hidden="true" className="text-gold-500 ml-1">*</span>}
        </label>
      )}

      <div className="relative flex items-center">
        {leftIcon && (
          <span aria-hidden="true" className="absolute left-3.5 text-slate-400 pointer-events-none flex items-center">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          name={name}
          required={required}
          aria-required={required || undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(
            'input',
            leftIcon && 'pl-10',
            rightIcon && 'pr-12',
            error && 'input-error',
            className
          )}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-1.5 min-w-11 min-h-11 text-slate-400 flex items-center justify-center">
            {rightIcon}
          </span>
        )}
      </div>

      {error && <p id={errorId} role="alert" className="text-xs text-red-400 flex items-center gap-1">{error}</p>}
      {!error && hint && <p id={hintId} className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
});

export default Input;
