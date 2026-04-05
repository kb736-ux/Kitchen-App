/**
 * Sheek — subscription tiers by employee count (profiles in org).
 * Loaded before adminSettings.js / employees.js / used from auth for labels.
 */
(function () {
  const PLANS = {
    starter: {
      id: 'starter',
      label: 'Starter',
      description: 'Up to 20 employees',
      maxEmployees: 20,
    },
    growth: {
      id: 'growth',
      label: 'Growth',
      description: '21–40 employees',
      maxEmployees: 40,
    },
    scale: {
      id: 'scale',
      label: 'Scale',
      description: '41+ employees (unlimited)',
      maxEmployees: null,
    },
  };

  function normalizePlanId(id) {
    const k = String(id || '').toLowerCase().trim();
    return PLANS[k] ? k : 'starter';
  }

  function getPlan(planId) {
    return PLANS[normalizePlanId(planId)] || PLANS.starter;
  }

  /** @returns {number|null} null = unlimited */
  function getEmployeeLimit(planId) {
    const m = getPlan(planId).maxEmployees;
    return m == null ? null : m;
  }

  function canAddEmployee(currentProfileCount, planId) {
    const lim = getEmployeeLimit(planId);
    if (lim == null) return true;
    return Number(currentProfileCount) < lim;
  }

  window.KK_SUBSCRIPTION_PLANS = PLANS;
  window.kkNormalizePlanId = normalizePlanId;
  window.kkGetSubscriptionPlan = getPlan;
  window.kkGetEmployeeLimit = getEmployeeLimit;
  window.kkCanAddEmployee = canAddEmployee;
})();
