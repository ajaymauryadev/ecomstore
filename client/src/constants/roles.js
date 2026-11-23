export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  STORE_OWNER: 'store_owner',
  STAFF: 'staff',
  PACKER: 'packer',
  DELIVERY: 'delivery',
  CUSTOMER: 'customer',
};

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  store_owner: 'Store Owner',
  staff: 'Staff',
  packer: 'Packer',
  delivery: 'Delivery',
  customer: 'Customer',
};

export const ROLE_COLORS = {
  super_admin: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  store_owner: 'text-gold-400 bg-gold-500/10 border-gold-500/20',
  staff: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  packer: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  delivery: 'text-green-400 bg-green-500/10 border-green-500/20',
  customer: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

export const STORE_ROLES = [ROLES.STORE_OWNER, ROLES.STAFF, ROLES.PACKER];
export const STAFF_ROLES = [ROLES.STAFF, ROLES.PACKER, ROLES.DELIVERY];
export const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.STORE_OWNER];
