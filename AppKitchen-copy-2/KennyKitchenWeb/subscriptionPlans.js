/**
 * Sheek — Per-user pricing model.
 * $3.00 per user/month for under 30 employees.
 * $2.50 per user/month for 30+ employees.
 * Loaded before adminSettings.js / employees.js / used from auth for labels.
 */
(function () {
  const PRICING = {
    standardRate: 3.00,    // $/user/month for < 30 employees
    bulkRate: 2.50,        // $/user/month for 30+ employees
    bulkThreshold: 30,     // employee count at which bulk rate kicks in
  };

  /** Returns the per-user rate based on employee count. */
  function getPerUserRate(employeeCount) {
    const count = Number(employeeCount) || 0;
    return count >= PRICING.bulkThreshold ? PRICING.bulkRate : PRICING.standardRate;
  }

  /** Returns the monthly cost for a given employee count. */
  function getMonthlyTotal(employeeCount) {
    const count = Number(employeeCount) || 0;
    if (count <= 0) return 0;
    const rate = getPerUserRate(count);
    return +(count * rate).toFixed(2);
  }

  /** Returns a human-readable pricing label. */
  function getPricingLabel(employeeCount) {
    const count = Number(employeeCount) || 0;
    const rate = getPerUserRate(count);
    const total = getMonthlyTotal(count);
    return `$${rate.toFixed(2)}/user × ${count} = $${total.toFixed(2)}/mo`;
  }

  /** Returns a description of the pricing tiers. */
  function getPricingDescription() {
    return `$${PRICING.standardRate.toFixed(2)}/user/mo · $${PRICING.bulkRate.toFixed(2)}/user/mo for ${PRICING.bulkThreshold}+ employees`;
  }

  // Legacy compatibility — no plan-based limits anymore, all users can add unlimited employees.
  function normalizePlanId(id) {
    return 'per_user';
  }

  function getPlan(planId) {
    return {
      id: 'per_user',
      label: 'Per User',
      description: getPricingDescription(),
      maxEmployees: null, // unlimited
    };
  }

  /** @returns {number|null} null = unlimited (no hard cap with per-user pricing) */
  function getEmployeeLimit(planId) {
    return null; // no limit — they pay per user
  }

  function canAddEmployee(currentProfileCount, planId) {
    return true; // always allowed — billing scales with usage
  }

  // Legacy plan object for backward compat
  const PLANS = {
    per_user: {
      id: 'per_user',
      label: 'Per User',
      description: getPricingDescription(),
      maxEmployees: null,
    },
    // Keep legacy keys so old code doesn't break
    starter: { id: 'per_user', label: 'Per User', description: getPricingDescription(), maxEmployees: null },
    growth:  { id: 'per_user', label: 'Per User', description: getPricingDescription(), maxEmployees: null },
    scale:   { id: 'per_user', label: 'Per User', description: getPricingDescription(), maxEmployees: null },
  };

  window.KK_SUBSCRIPTION_PLANS = PLANS;
  window.KK_PRICING = PRICING;
  window.kkNormalizePlanId = normalizePlanId;
  window.kkGetSubscriptionPlan = getPlan;
  window.kkGetEmployeeLimit = getEmployeeLimit;
  window.kkCanAddEmployee = canAddEmployee;
  window.kkGetPerUserRate = getPerUserRate;
  window.kkGetMonthlyTotal = getMonthlyTotal;
  window.kkGetPricingLabel = getPricingLabel;
  window.kkGetPricingDescription = getPricingDescription;
})();
