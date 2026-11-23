export function upiPaymentUri({ upiId, upiName }, amount) {
  const params = new URLSearchParams({ pa: upiId.trim(), cu: 'INR' });
  if (upiName?.trim()) params.set('pn', upiName.trim());
  if (Number(amount) > 0) params.set('am', Number(amount).toFixed(2));
  return `upi://pay?${params}`;
}
