const SYMBOL_CURRENCIES = [
  { pattern: /₹|(?:\bINR\b)|(?:\bRs\.?\b)/i, currency: 'INR' },
  { pattern: /\$|(?:\bUSD\b)/i, currency: 'USD' },
  { pattern: /€|(?:\bEUR\b)/i, currency: 'EUR' },
  { pattern: /£|(?:\bGBP\b)/i, currency: 'GBP' },
  { pattern: /(?:\bCAD\b)/i, currency: 'CAD' },
  { pattern: /(?:\bAUD\b)/i, currency: 'AUD' },
];

export function classifyCompensation(job, eligibility, config) {
  const haystack = `${job.compensation || ''} ${job.salary || ''} ${job.snippet || ''}`;
  const extracted = extractCompensation(haystack);
  const policy = choosePolicy(eligibility, config.compensation);
  if (!policy?.minimum_annual) {
    return {
      status: extracted ? 'listed' : 'not_configured',
      label: extracted ? formatExtracted(extracted) : 'No minimum configured',
      extracted,
      gate: false,
    };
  }
  if (!extracted) {
    return {
      status: 'unknown',
      label: `Not listed; target minimum ${formatMoney(policy.minimum_annual, policy.currency)}`,
      extracted: null,
      gate: false,
    };
  }
  if (policy.currency && extracted.currency && policy.currency !== extracted.currency) {
    return {
      status: 'currency_mismatch',
      label: `${formatExtracted(extracted)}; target is in ${policy.currency}`,
      extracted,
      gate: false,
    };
  }
  const annualMax = extracted.max ?? extracted.min;
  const belowMinimum = annualMax !== null && annualMax < policy.minimum_annual;
  return {
    status: belowMinimum ? 'below_minimum' : 'meets_minimum',
    label: belowMinimum
      ? `${formatExtracted(extracted)}; below ${formatMoney(policy.minimum_annual, policy.currency)} target`
      : `${formatExtracted(extracted)}; meets target`,
    extracted,
    gate: belowMinimum,
  };
}

export function extractCompensation(value = '') {
  const text = String(value);
  const currency = SYMBOL_CURRENCIES.find(({ pattern }) => pattern.test(text))?.currency || null;
  const lpa = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?)/i)
    || text.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?)/i);
  if (lpa) {
    const min = Number(lpa[1]) * 100000;
    const max = lpa[2] ? Number(lpa[2]) * 100000 : min;
    return { currency: currency || 'INR', min, max, period: 'annual' };
  }

  const range = text.match(/(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD|Rs\.?)?\s*([\d,.]+)\s*([kKmM]?)\s*(?:-|–|to)\s*(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD|Rs\.?)?\s*([\d,.]+)\s*([kKmM]?)/i);
  if (range) {
    const min = scaledNumber(range[1], range[2]);
    const max = scaledNumber(range[3], range[4]);
    if (min !== null && max !== null && Math.max(min, max) >= 10000) {
      return { currency, min, max, period: 'annual' };
    }
  }

  const single = text.match(/(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD|Rs\.?)\s*([\d,.]+)\s*([kKmM]?)/i);
  if (single) {
    const amount = scaledNumber(single[1], single[2]);
    if (amount !== null && amount >= 10000) return { currency, min: amount, max: amount, period: 'annual' };
  }
  return null;
}

function choosePolicy(eligibility, compensation) {
  if (eligibility.remote) return compensation.remote?.minimum_annual ? compensation.remote : compensation.home_country;
  if (eligibility.status === 'open') return compensation.home_country;
  return compensation.international;
}

function scaledNumber(raw, suffix = '') {
  const number = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  if (suffix.toLowerCase() === 'k') return number * 1000;
  if (suffix.toLowerCase() === 'm') return number * 1000000;
  return number;
}

function formatExtracted(value) {
  const amount = value.min === value.max
    ? formatMoney(value.min, value.currency)
    : `${formatMoney(value.min, value.currency)}-${formatMoney(value.max, value.currency)}`;
  return `${amount} annual`;
}

function formatMoney(value, currency) {
  if (!Number.isFinite(value)) return 'unknown';
  const prefix = currency ? `${currency} ` : '';
  return `${prefix}${Math.round(value).toLocaleString('en-US')}`;
}
