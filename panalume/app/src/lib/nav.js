// Grouping for the dock (item 19: Home · Family · House · Systems).
// A view may name its own group (`group` on the view); otherwise the name and
// id decide, so an existing layout groups correctly with no config change.

export const GROUP_ORDER = ['Home', 'Family', 'House', 'Systems'];

const RULES = [
  ['Home', /^(home|start|today|overview)$|\bhome\b/i],
  ['Family', /family|kitchen|chore|kid|child|meal|calendar|birthday|contact/i],
  ['House', /house|floor|trash|bin|util|climate|thermo|weather|outdoor|garden|inventory|box|room/i],
  ['Systems', /infra|system|server|network|media|music|movie|tv|power|energy|solar|security|camera/i],
];

/** The group a view belongs to. */
export function groupOf(view) {
  const named = String(view?.group || '').trim();
  if (named) {
    const hit = GROUP_ORDER.find((g) => g.toLowerCase() === named.toLowerCase());
    return hit || named;
  }
  const hay = `${view?.name || ''} ${view?.id || ''}`;
  for (const [label, re] of RULES) if (re.test(hay)) return label;
  return 'More';
}

/**
 * Views bucketed in group order. `[{ group, views }]`, empty groups dropped,
 * views keeping their configured order inside a group.
 */
export function groupViews(views = []) {
  const buckets = new Map();
  for (const v of views) {
    const g = groupOf(v);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push(v);
  }
  const rank = (g) => {
    const i = GROUP_ORDER.indexOf(g);
    return i < 0 ? GROUP_ORDER.length + 1 : i;
  };
  return [...buckets.entries()]
    .map(([group, list]) => ({ group, views: list }))
    .sort((a, b) => rank(a.group) - rank(b.group));
}
