const clean = (value, max = 120) => String(value || "").replace(/\s+/gu, " ").trim().slice(0, max);

export function moneyMinor(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) throw new Error("Enter a valid monthly price.");
  return Math.round(amount * 100);
}

export function planInput(form) {
  const name = clean(form.name, 80);
  const code = clean(form.code, 32).toUpperCase();
  const currency = clean(form.currency, 3).toUpperCase();
  if (name.length < 2 || !/^[A-Z0-9][A-Z0-9_-]{1,31}$/u.test(code) || !/^[A-Z]{3}$/u.test(currency)) throw new Error("Complete the plan name, code and currency.");
  const integer = (value, label, min = 0) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min) throw new Error(`Enter a valid ${label}.`);
    return parsed;
  };
  return {
    planId: clean(form.planId, 96), name, code, currency, description: clean(form.description, 300), monthlyPriceMinor: moneyMinor(form.monthlyPrice),
    limits: {
      seats: integer(form.seats, "seat limit", 1),
      whatsappAccounts: integer(form.whatsappAccounts, "WhatsApp account limit"),
      monthlyDrafts: integer(form.monthlyDrafts, "draft limit"),
      monthlyTranslations: integer(form.monthlyTranslations, "translation limit"),
      historyMessages: integer(form.historyMessages, "history-message limit", 1000),
      storageMb: integer(form.storageMb, "storage limit", 100),
    },
  };
}

export function couponInput(form) {
  const code = clean(form.code, 32).toUpperCase();
  if (code && !/^[A-Z0-9][A-Z0-9_-]{1,31}$/u.test(code)) throw new Error("Enter a valid coupon code or leave it blank for automatic generation.");
  return {
    code, planId: clean(form.planId, 96), discountPercent: Number(form.discountPercent),
    maxRedemptions: Number(form.maxRedemptions), expiresAt: clean(form.expiresAt, 40) || null,
  };
}

export function subscriptionInput(form) {
  return { tenantId: clean(form.tenantId, 96), planId: clean(form.planId, 96), status: clean(form.status, 20), couponCode: clean(form.couponCode, 32).toUpperCase(), currentPeriodEnd: clean(form.currentPeriodEnd, 40) || null };
}

export function normalizeDashboard(value) {
  return {
    actor: value?.actor || null, metrics: value?.metrics || { tenants: 0, activeUsers: 0, activeSubscriptions: 0, coupons: 0, mrrByCurrency: [] },
    byPlan: Array.isArray(value?.byPlan) ? value.byPlan : [], tenants: Array.isArray(value?.tenants) ? value.tenants : [], users: Array.isArray(value?.users) ? value.users : [],
    plans: Array.isArray(value?.plans) ? value.plans : [], coupons: Array.isArray(value?.coupons) ? value.coupons : [],
  };
}
