import { baseApi } from '../../api/baseApi';
import { stockViewTags } from '../../api/workspaceTags';

export const inventoryApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getInventoryDashboard: builder.query({
      query: () => '/inventory/dashboard',
      providesTags: [{ type: 'Inventory', id: 'DASHBOARD' }],
    }),

    getInventoryList: builder.query({
      query: (params = {}) => ({ url: '/inventory/list', params }),
      providesTags: [{ type: 'Inventory', id: 'LIST' }],
    }),

    getLowStockProducts: builder.query({
      query: () => '/inventory/low-stock',
      providesTags: [{ type: 'Inventory', id: 'LOW_STOCK' }],
    }),

    getStockValueReport: builder.query({
      query: (params = {}) => ({ url: '/inventory/stock-value', params }),
      providesTags: [{ type: 'Inventory', id: 'STOCK_VALUE' }],
    }),

    adjustStock: builder.mutation({
      query: (body) => ({ url: '/inventory/adjust', method: 'POST', body }),
      invalidatesTags: (result, error, { productId }) => error ? [] : stockViewTags([productId]),
    }),

    getStockLedger: builder.query({
      query: ({ productId, ...params }) => ({ url: `/inventory/ledger/${productId}`, params }),
      providesTags: (result, error, { productId }) => [{ type: 'StockLedger', id: productId }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetInventoryDashboardQuery,
  useGetInventoryListQuery,
  useGetLowStockProductsQuery,
  useGetStockValueReportQuery,
  useAdjustStockMutation,
  useGetStockLedgerQuery,
} = inventoryApi;
