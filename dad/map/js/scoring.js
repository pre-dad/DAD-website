/* Pure scoring over the columnar county data (d). No DOM, so it can be unit tested in Node. */

/** Severity column for an indicator key, or null when the indicator is not loaded. */
export function severityCol(d, key) {
  const ind = d.indicators[key];
  return ind ? ind.sev : null;
}

/** Weighted mean of severities, renormalised per county over available data. */
export function computeIndex(d, weights) {
  const keys = Object.keys(weights).filter(k => weights[k] > 0 && d.indicators[k]);
  const n = d.count;
  const out = new Float64Array(n).fill(NaN);
  const completeness = new Float64Array(n);

  if (!keys.length) return { scores: out, completeness, keys };

  const cols = keys.map(k => d.indicators[k].sev);
  const w = keys.map(k => weights[k]);
  const totalW = w.reduce((a, b) => a + b, 0);

  for (let i = 0; i < n; i++) {
    let sum = 0, wsum = 0;
    for (let j = 0; j < cols.length; j++) {
      const v = cols[j][i];
      if (v === null || v === undefined) continue;
      sum += v * w[j];
      wsum += w[j];
    }
    completeness[i] = wsum / totalW;
    // Require at least half the requested weight to be backed by real data,
    // otherwise a county with one lucky indicator outranks a fully-measured one.
    out[i] = wsum > 0 && completeness[i] >= 0.5 ? sum / wsum : NaN;
  }
  return { scores: out, completeness, keys };
}

/** Blend of need (the weighted index) and service scarcity; needShare is a percentage. */
export function computeGap(d, weights, supplyKey, needShare) {
  const need = computeIndex(d, weights);
  const supplyCol = severityCol(d, supplyKey);
  const n = d.count;
  const out = new Float64Array(n).fill(NaN);

  if (!supplyCol) return { scores: out, missingSupply: true };

  const a = needShare / 100, b = 1 - a;
  for (let i = 0; i < n; i++) {
    const nv = need.scores[i], sv = supplyCol[i];
    // supply indicators are higher_is_better, so their severity is already
    // "high = underserved". Both high = high need, nobody working there.
    out[i] = (Number.isNaN(nv) || sv === null || sv === undefined) ? NaN : nv * a + sv * b;
  }
  return { scores: out, missingSupply: false };
}
