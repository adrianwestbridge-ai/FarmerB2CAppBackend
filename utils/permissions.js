// Fine-grained admin permissions. The Super Admin implicitly holds every permission;
// ADMIN / MODERATOR accounts hold whatever the Super Admin assigns (defaults below).

const PERMISSIONS = {
  ORDERS_APPROVE: 'ORDERS_APPROVE',         // verify farmer by phone, approve / reject / cancel orders
  ORDERS_ASSIGN: 'ORDERS_ASSIGN',           // assign / reassign / release delivery partners
  PAYMENTS_VERIFY: 'PAYMENTS_VERIFY',       // verify online payments, record refunds
  OFFERS_MANAGE: 'OFFERS_MANAGE',           // create / edit / activate offers
  PRODUCTS_MANAGE: 'PRODUCTS_MANAGE',       // products, categories, stock
  USERS_MANAGE: 'USERS_MANAGE',             // farmers & delivery partners, password resets
  SETTLEMENTS_MANAGE: 'SETTLEMENTS_MANAGE', // verify / dispute cash handovers
  REPORTS_VIEW: 'REPORTS_VIEW',             // business reports and exports
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

const DEFAULT_PERMISSIONS = {
  ADMIN: [
    PERMISSIONS.ORDERS_APPROVE,
    PERMISSIONS.ORDERS_ASSIGN,
    PERMISSIONS.PAYMENTS_VERIFY,
    PERMISSIONS.OFFERS_MANAGE,
    PERMISSIONS.PRODUCTS_MANAGE,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.SETTLEMENTS_MANAGE,
  ],
  MODERATOR: [
    PERMISSIONS.ORDERS_APPROVE,
    PERMISSIONS.ORDERS_ASSIGN,
  ],
};

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'];

const effectivePermissions = (admin) => {
  if (!admin) return [];
  if (admin.role === 'SUPER_ADMIN') return ALL_PERMISSIONS;
  return Array.isArray(admin.permissions) ? admin.permissions.filter((p) => ALL_PERMISSIONS.includes(p)) : [];
};

const hasPermission = (admin, permission) => effectivePermissions(admin).includes(permission);

module.exports = {
  PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  ADMIN_ROLES,
  effectivePermissions,
  hasPermission,
};
