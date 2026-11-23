export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const registrationFields = {
  name: 'name',
  email: 'email',
  password: 'password',
  phone: 'phone',
  storeName: 'storeName',
  storeSlug: 'storeSlug',
  slug: 'storeSlug',
};

export function getAuthErrors(error, registering = false) {
  const message = error?.data?.message || 'Something went wrong. Please try again.';
  const fields = registering ? registrationFields : { email: 'email', password: 'password' };
  const errors = {};

  if (Array.isArray(error?.data?.errors)) {
    for (const { field, message: detail } of error.data.errors) {
      if (Object.hasOwn(fields, field) && !errors[fields[field]]) errors[fields[field]] = detail;
    }
  }

  if (registering && error?.status === 409) {
    if (/^email\b/i.test(message)) return { email: message };
    if (/^(?:store url|slug)\b/i.test(message)) return { storeSlug: 'This store URL is already taken. Choose another.' };
  }

  return Object.keys(errors).length ? errors : { form: message };
}

export function focusAuthError(formElement, errors) {
  const firstInvalid = Array.from(formElement.elements).find(({ name }) => errors[name]);
  firstInvalid?.focus();
}
