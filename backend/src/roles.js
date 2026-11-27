// The roles an admin panel account can have. Every account has exactly one, kept in admin_users.role.
//   admin       opens every admin screen, including Users
//   support     works on the floor, can only read and change the Wi-Fi network and password
// A route is closed to the support user unless it says otherwise, see requireAdmin and requireStaff in auth.js.
const ADMIN = "admin";
const SUPPORT = "support";
const ROLES = [ADMIN, SUPPORT];

module.exports = { ADMIN, SUPPORT, ROLES };
