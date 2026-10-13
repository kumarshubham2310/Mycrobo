const ROLES = new Set(["owner", "admin", "member", "viewer"]);
const STATES = new Set(["active", "disabled"]);

const clean = (value, max = 120) => String(value || "").replace(/\s+/gu, " ").trim().slice(0, max);

export function canOpenAdmin(auth) {
  return auth?.authenticated === true && (
    auth?.user?.platformAdmin === true || ["owner", "admin"].includes(auth?.tenant?.role)
  );
}

export function normalizeAdminSnapshot(value) {
  const tenants = Array.isArray(value?.tenants) ? value.tenants.map((item) => ({
    id: clean(item?.id, 96), name: clean(item?.name || item?.label, 80),
    status: item?.status === "suspended" ? "suspended" : "active",
    memberCount: Math.max(0, Number(item?.memberCount) || 0),
  })).filter((item) => item.id && item.name) : [];
  const users = Array.isArray(value?.users) ? value.users.map((item) => ({
    id: clean(item?.id, 96), displayName: clean(item?.displayName || item?.display_name, 80),
    email: clean(item?.email, 254), status: item?.status === "disabled" ? "disabled" : "active",
    platformAdmin: item?.platformAdmin === true || item?.platform_admin === 1,
  })).filter((item) => item.id) : [];
  const memberships = Array.isArray(value?.memberships) ? value.memberships.map((item) => ({
    userId: clean(item?.userId || item?.user_id, 96), tenantId: clean(item?.tenantId || item?.tenant_id, 96),
    role: ROLES.has(item?.role) ? item.role : "member", status: STATES.has(item?.status) ? item.status : "active",
  })).filter((item) => item.userId && item.tenantId) : [];
  return { tenants, users, memberships };
}

export function validateTenant(values) {
  const name = clean(values?.name, 80);
  if (name.length < 2) throw new Error("Enter a workspace name.");
  return { name };
}

export function validateAdminUser(values) {
  const displayName = clean(values?.displayName, 80);
  const email = clean(values?.email, 254).toLocaleLowerCase();
  const password = String(values?.password || "");
  const tenantId = clean(values?.tenantId, 96);
  const role = ROLES.has(values?.role) ? values.role : "member";
  if (displayName.length < 2) throw new Error("Enter the person's name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error("Enter a valid email address.");
  if (password.length < 12 || password.length > 256) throw new Error("Use a temporary password of at least 12 characters.");
  if (!tenantId) throw new Error("Choose a workspace.");
  return { displayName, email, password, tenantId, role, platformAdmin: values?.platformAdmin === true || values?.platformAdmin === "on" };
}

export function validateMembership(values) {
  const userId = clean(values?.userId, 96);
  const tenantId = clean(values?.tenantId, 96);
  const role = ROLES.has(values?.role) ? values.role : "member";
  const status = STATES.has(values?.status) ? values.status : "active";
  if (!userId || !tenantId) throw new Error("Choose a person and workspace.");
  return { userId, tenantId, role, status };
}
