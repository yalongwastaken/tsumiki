// A3 — "typical monthly income". Prefer what you've actually logged (rolling
// average over complete prior months) once there's enough history; otherwise
// fall back to the typed source estimates. Mirrors server engine.typicalIncome.
export function typicalIncome(profile, transactions = []) {
  const sources = profile?.incomeSources || [];
  const typed = sources.length
    ? sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0)
    : (profile?.typicalIncome || 0);

  const ym = new Date().toISOString().slice(0, 7);
  const byMonth = {};
  for (const t of transactions)
    if (t.type === "income") {
      const m = new Date(t.date).toISOString().slice(0, 7);
      if (m < ym) byMonth[m] = (byMonth[m] || 0) + t.amount; // complete months only
    }
  const months = Object.values(byMonth);
  if (months.length >= 2) return Math.round(months.reduce((a, b) => a + b, 0) / months.length);
  return typed;
}
