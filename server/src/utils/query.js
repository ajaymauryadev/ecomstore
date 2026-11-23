export const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const parsePagination = (query, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const requestedPage = Number.parseInt(query?.page, 10);
  const requestedLimit = Number.parseInt(query?.limit, 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, maxLimit)
    : defaultLimit;
  return { page, limit, skip: (page - 1) * limit };
};
