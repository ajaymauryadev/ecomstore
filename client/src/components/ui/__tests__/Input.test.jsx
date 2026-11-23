import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import Input from '../Input';

describe('Input', () => {
  test('creates unique label associations and accessible error and hint descriptions', () => {
    render(<>
      <Input name="first" label="Mobile number" hint="Ten digits" />
      <Input name="second" label="Mobile number" error="Mobile number is invalid" required />
    </>);
    const fields = screen.getAllByLabelText(/Mobile number/);
    expect(fields[0].id).not.toBe(fields[1].id);
    expect(fields[0]).toHaveAttribute('name', 'first');
    expect(fields[0]).toHaveAccessibleDescription('Ten digits');
    expect(fields[1]).toHaveAttribute('aria-invalid', 'true');
    expect(fields[1]).toHaveAccessibleDescription('Mobile number is invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('Mobile number is invalid');
  });
});
