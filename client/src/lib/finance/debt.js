// debt.js — deterministic debt-payoff projection. Simulates paying a fixed monthly
// budget (the sum of minimums plus any extra) month by month, rolling freed
// minimums onto the focus debt (avalanche = highest APR first, snowball = smallest
// balance first). Pure + testable: drives the "debt-free by" timeline.

const EPS = 0.005; // treat sub-cent balances as paid off

/**
 * Project a debt payoff schedule.
 * @param {Array<{id,name,balance,apr,minPayment}>} debts
 * @param {{extra?:number, strategy?:string, maxMonths?:number, today?:Date}} [opts]
 *   extra = additional dollars/month beyond the minimums; strategy = avalanche|snowball
 * @returns {{months, debtFree, totalInterest, totalPaid, monthlyPayment, payoffDate, order}}
 *   order = [{id, name, month}] in the sequence debts are cleared
 */
export function payoffPlan(debts = [], opts = {}) {
  const { extra = 0, strategy = "avalanche", maxMonths = 600, today = new Date() } = opts;
  // only debts with a real balance matter
  const active = (debts || [])
    .filter((d) => (d.balance || 0) > 0)
    .map((d) => ({
      id: d.id,
      name: d.name || "Debt",
      balance: d.balance,
      apr: Math.max(0, d.apr || 0),
      min: Math.max(0, d.minPayment || 0),
    }));
  if (!active.length) {
    return {
      months: 0,
      debtFree: true,
      totalInterest: 0,
      totalPaid: 0,
      monthlyPayment: 0,
      payoffDate: null,
      order: [],
    };
  }

  // focus order comparator: snowball clears the smallest balance first
  // (motivation), avalanche the highest APR first (least interest)
  const byFocus = (a, b) => (strategy === "snowball" ? a.balance - b.balance : b.apr - a.apr);

  // the monthly budget is held constant — as debts clear, their freed minimums
  // roll into the focus debt rather than shrinking what you pay
  const monthlyPayment = active.reduce((s, d) => s + d.min, 0) + Math.max(0, extra);

  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;
  const order = [];

  while (active.some((d) => d.balance > EPS) && month < maxMonths) {
    month++;
    // accrue one month of interest on every unpaid debt
    for (const d of active) {
      if (d.balance > EPS) {
        const interest = d.balance * (d.apr / 100 / 12);
        d.balance += interest;
        totalInterest += interest;
      }
    }
    let pool = monthlyPayment;
    const live = active.filter((d) => d.balance > EPS);
    // pay each minimum first (capped at the balance and the remaining pool)
    for (const d of live) {
      const pay = Math.min(d.min, d.balance, pool);
      d.balance -= pay;
      pool -= pay;
      totalPaid += pay;
    }
    // throw whatever's left at the focus debt(s), in strategy order
    // (sort `live` in place — it's already a fresh array this iteration)
    live.sort(byFocus);
    for (const d of live) {
      if (pool <= EPS) {
        break;
      }
      const pay = Math.min(d.balance, pool);
      d.balance -= pay;
      pool -= pay;
      totalPaid += pay;
    }
    // record any debt cleared this month
    for (const d of active) {
      if (d.balance <= EPS && !order.find((o) => o.id === d.id)) {
        d.balance = 0;
        order.push({ id: d.id, name: d.name, month });
      }
    }
  }

  const debtFree = active.every((d) => d.balance <= EPS);
  // anchor on day 1 so adding months never skips a short month (e.g. Jan 31 + 1mo)
  const payoffDate = debtFree ? new Date(today.getFullYear(), today.getMonth() + month, 1) : null;
  return {
    months: month,
    debtFree, // false → the budget can't outrun interest within maxMonths
    // totals are only meaningful for a real payoff; null when the budget never wins
    totalInterest: debtFree ? Math.round(totalInterest) : null,
    totalPaid: debtFree ? Math.round(totalPaid) : null,
    monthlyPayment: Math.round(monthlyPayment),
    payoffDate,
    order,
  };
}
