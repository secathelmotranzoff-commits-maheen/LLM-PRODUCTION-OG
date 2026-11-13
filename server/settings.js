export function parsePort(value = '3000') {
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 65535) throw new Error('PORT must be a number between 0 and 65535.');
  return Number(value);
}
