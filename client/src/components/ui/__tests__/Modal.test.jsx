import { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, test, vi } from 'vitest';
import Modal from '../Modal';

describe('Modal', () => {
  test('labels the dialog, traps focus, closes with Escape, restores focus, and has no serious axe violations', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 1, height: 1 }]);
    const initialFocusRef = createRef();
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <Modal isOpen onClose={onClose} title="Confirm stock adjustment" initialFocusRef={initialFocusRef}>
        <button ref={initialFocusRef}>Confirm</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm stock adjustment' });
    await waitFor(() => expect(initialFocusRef.current).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(initialFocusRef.current).toHaveFocus();

    const result = await axe.run(dialog);
    expect(result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))).toEqual([]);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<Modal isOpen={false} onClose={onClose} title="Confirm stock adjustment" />);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });
});
