import { baseApi } from '../../api/baseApi';

export const reportsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSalesOverview: builder.query({
      query: (params) => ({ url: '/reports/sales-overview', params }),
      providesTags: [{ type: 'Reports', id: 'sales-overview' }],
    }),
    getProfitLoss: builder.query({
      query: (params) => ({ url: '/reports/profit-loss', params }),
      providesTags: (r, e, p) => [{ type: 'Reports', id: `pl-${JSON.stringify(p)}` }],
    }),
    getDailySales: builder.query({
      query: (params) => ({ url: '/reports/daily-sales', params }),
      providesTags: (r, e, p) => [{ type: 'Reports', id: `daily-${p?.date}` }],
    }),
    getMonthlySales: builder.query({
      query: (params) => ({ url: '/reports/monthly-sales', params }),
      providesTags: (r, e, p) => [{ type: 'Reports', id: `monthly-${p?.year}-${p?.month}` }],
    }),
    getYearlySales: builder.query({
      query: (params) => ({ url: '/reports/yearly-sales', params }),
      providesTags: (r, e, p) => [{ type: 'Reports', id: `yearly-${p?.year}` }],
    }),
    getProductSales: builder.query({
      query: (params) => ({ url: '/reports/product-sales', params }),
      providesTags: [{ type: 'Reports', id: 'product-sales' }],
    }),
    getCategorySales: builder.query({
      query: (params) => ({ url: '/reports/category-sales', params }),
      providesTags: [{ type: 'Reports', id: 'category-sales' }],
    }),
    getStockReport: builder.query({
      query: (params) => ({ url: '/reports/stock', params }),
      providesTags: [{ type: 'Reports', id: 'stock' }],
    }),
    getSupplierDuesReport: builder.query({
      query: (params = {}) => ({ url: '/reports/supplier-dues', params }),
      providesTags: [{ type: 'Reports', id: 'supplier-dues' }],
    }),
    getCustomerDuesReport: builder.query({
      query: (params = {}) => ({ url: '/reports/customer-dues', params }),
      providesTags: [{ type: 'Reports', id: 'customer-dues' }],
    }),
    getExpenseReport: builder.query({
      query: (params) => ({ url: '/reports/expenses', params }),
      providesTags: [{ type: 'Reports', id: 'expenses' }],
    }),
    getSalaryReport: builder.query({
      query: (params) => ({ url: '/reports/salary', params }),
      providesTags: [{ type: 'Reports', id: 'salary' }],
    }),
    getPurchaseReport: builder.query({
      query: (params) => ({ url: '/reports/purchases', params }),
      providesTags: [{ type: 'Reports', id: 'purchases' }],
    }),
  }),
});

export const {
  useGetSalesOverviewQuery,
  useGetProfitLossQuery,
  useGetDailySalesQuery,
  useGetMonthlySalesQuery,
  useGetYearlySalesQuery,
  useGetProductSalesQuery,
  useGetCategorySalesQuery,
  useGetStockReportQuery,
  useGetSupplierDuesReportQuery,
  useGetCustomerDuesReportQuery,
  useGetExpenseReportQuery,
  useGetSalaryReportQuery,
  useGetPurchaseReportQuery,
} = reportsApi;
