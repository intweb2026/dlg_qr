// The roles of an admin panel account, the same two the API uses, see backend/src/roles.js.
//   admin       opens every admin screen
//   support     only the Wi-Fi screen, the API refuses everything else
export const ADMIN = "admin";
export const SUPPORT = "support";

export const ROLE_LABELS = { [ADMIN]: "Admin", [SUPPORT]: "Support" };

/** The admin page an account lands on after signing in. */
export const homePage = (role) => (role === SUPPORT ? "/admin/wifi" : "/admin/feedback-submission");
