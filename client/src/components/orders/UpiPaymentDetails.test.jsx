import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import UpiPaymentDetails from './UpiPaymentDetails';
import { upiPaymentUri } from '../../utils/upi';

const settings = { upiId: '6394746719@ybl', upiName: 'Ajay Maurya' };

test('encodes the configured recipient, currency, name and order amount in the UPI URI', () => {
  const uri = new URL(upiPaymentUri(settings, 123.45));
  expect(uri.protocol).toBe('upi:');
  expect(uri.hostname).toBe('pay');
  expect(Object.fromEntries(uri.searchParams)).toEqual({ pa: settings.upiId, pn: settings.upiName, cu: 'INR', am: '123.45' });
  expect(new URL(upiPaymentUri(settings)).searchParams.has('am')).toBe(false);
});

test('shows the owner uploaded QR image alongside their UPI ID', () => {
  render(<UpiPaymentDetails settings={{ ...settings, upiQrUrl: '/uploads/store/payment.webp' }} showQr />);
  expect(screen.getByRole('img', { name: 'Store UPI QR code' })).toHaveAttribute('src', expect.stringMatching(/\/uploads\/store\/payment\.webp$/));
  expect(screen.getByText(settings.upiId)).toBeInTheDocument();
  expect(document.querySelector('svg')).toBeNull();
});

test('generates a QR for the displayed UPI ID and copies the same recipient', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<UpiPaymentDetails settings={settings} showQr amount={123.45} />);
  expect(screen.getByRole('img', { name: 'UPI QR code for 6394746719@ybl' }).tagName).toBe('svg');
  expect(screen.getByText(settings.upiId)).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(settings.upiId));
});
