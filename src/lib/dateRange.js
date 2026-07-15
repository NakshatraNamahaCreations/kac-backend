function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  return addDays(x, -day);
}
function fmt(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function resolveDateRange(preset, from, to) {
  const now = new Date();
  switch (preset) {
    case 'today': {
      const start = startOfDay(now);
      return { preset, from: start, to: addDays(start, 1), label: 'Today' };
    }
    case 'yesterday': {
      const start = addDays(startOfDay(now), -1);
      return { preset, from: start, to: addDays(start, 1), label: 'Yesterday' };
    }
    case 'this_week': {
      const start = startOfWeek(now);
      return { preset, from: start, to: addDays(start, 7), label: `${fmt(start)} – ${fmt(addDays(start, 6))}` };
    }
    case 'last_week': {
      const start = addDays(startOfWeek(now), -7);
      return { preset, from: start, to: addDays(start, 7), label: `${fmt(start)} – ${fmt(addDays(start, 6))}` };
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { preset, from: start, to: end, label: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { preset, from: start, to: end, label: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
    }
    case 'custom': {
      const start = from ? startOfDay(new Date(from)) : startOfDay(now);
      const end = to ? addDays(startOfDay(new Date(to)), 1) : addDays(start, 1);
      return { preset, from: start, to: end, label: `${fmt(start)} – ${fmt(addDays(end, -1))}` };
    }
    case 'all_time':
    default:
      return { preset: 'all_time', from: new Date(0), to: addDays(now, 1), label: 'All time' };
  }
}

module.exports = { resolveDateRange };
