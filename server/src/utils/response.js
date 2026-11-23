export const sendSuccess = (res, data, statusCode = 200, meta = {}) =>
  res.status(statusCode).json({ status: 'success', ...meta, data });

export const sendPaginated = (res, data, total, page, limit, extraMeta = {}) =>
  res.status(200).json({
    status: 'success',
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
      ...extraMeta,
    },
  });
