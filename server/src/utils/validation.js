const PUBLIC_UPLOAD_URL = /^\/uploads\/[a-f\d]{24}\/[a-f\d-]{36}\.webp$/i;

export const isSafeImageUrl = (value) => {
  const input = String(value || '').trim();
  if (input.length > 2048) return false;
  if (PUBLIC_UPLOAD_URL.test(input)) return true;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};
