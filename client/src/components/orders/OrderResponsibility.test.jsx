import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import OrderResponsibility from './OrderResponsibility';
import WorkAssigneePicker from './WorkAssigneePicker';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { _id: 'owner', name: 'Shop Owner', role: 'store_owner' } }),
}));
const roster = vi.hoisted(() => vi.fn());
vi.mock('../../features/staff/staffApi', () => ({ useGetStaffQuery: roster }));

describe('Order responsibility', () => {
  test('distinguishes the assigned employee from the owner who completed the work', () => {
    render(<OrderResponsibility order={{ orderType: 'home_delivery', status: 'delivered', fulfillment: {
      packingAssignedTo: { name: 'Assigned Packer', role: 'packer' },
      packingAssignedBy: { name: 'Shop Owner', role: 'store_owner' },
      packingCompletedBy: { name: 'Shop Owner', role: 'store_owner' },
      deliveryAssignedTo: { name: 'Assigned Driver', role: 'delivery' },
      deliveredBy: { name: 'Actual Driver', role: 'staff' },
    } }} />);
    expect(screen.getByText(/Packing assigned to:/).closest('p')).toHaveTextContent('Assigned Packer (packer)');
    expect(screen.getByText(/Assigned by/)).toHaveTextContent('Shop Owner (store owner)');
    expect(screen.getByText(/Completed by Shop Owner/)).toBeInTheDocument();
    expect(screen.getByText(/Delivery assigned to:/).closest('p')).toHaveTextContent('Assigned Driver (delivery)');
    expect(screen.getByText(/Completed by Actual Driver/)).toBeInTheDocument();
  });

  test('shows missing historical attribution without inventing a worker', () => {
    render(<OrderResponsibility order={{ orderType: 'home_delivery', status: 'delivered' }} />);
    expect(screen.getAllByText('Completion not recorded')).toHaveLength(2);
    expect(screen.queryByText(/Completed by/)).not.toBeInTheDocument();
  });

  test('supports owner self assignment and finding employees beyond the first page', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    roster.mockImplementation(({ page }) => ({ data: {
      data: page === 2 ? [{ _id: 'packer', name: 'Second Page Packer', role: 'packer', isActive: true }] : [],
      meta: { totalPages: 2 },
    } }));
    render(<WorkAssigneePicker kind="packing" onSave={save} />);
    await user.selectOptions(screen.getByRole('combobox'), 'owner');
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(save).toHaveBeenLastCalledWith('owner');
    await user.click(screen.getByRole('button', { name: 'Next staff' }));
    await user.selectOptions(screen.getByRole('combobox'), 'packer');
    await user.type(screen.getByRole('textbox'), 'Second');
    await waitFor(() => expect(roster).toHaveBeenLastCalledWith({ page: 1, limit: 5, search: 'Second' }));
    expect(screen.getByRole('combobox')).toHaveValue('packer');
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(save).toHaveBeenLastCalledWith('packer');
  });
});
