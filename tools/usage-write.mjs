// Записує поточні відсотки лімітів у .claude/usage-state.json (коли статус-рядок
// не запускається, лід бере їх з інструмента get_usage і передає сюди).
// Використання: node tools/usage-write.mjs <5h%> <week%> <fable%> [5h_resets_at] [week_resets_at]
import { writeFileSync } from 'node:fs';
const [h5, wk, fb, r5 = null, rw = null] = process.argv.slice(2);
const state = {
  rate_limits: {
    five_hour: { used_percentage: Number(h5), resets_at: r5 },
    seven_day: { used_percentage: Number(wk), resets_at: rw },
    seven_day_fable: { used_percentage: Number(fb), resets_at: rw },
  },
  source: 'get_usage',
  updated_at: new Date().toISOString(),
};
writeFileSync('.claude/usage-state.json', JSON.stringify(state, null, 2));
console.log('usage-state:', h5, wk, fb);
