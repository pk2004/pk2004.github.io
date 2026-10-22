// Working days remaining until 1 July 2027.
// Skips weekends, England & Wales bank holidays and 30 December (a fixed day off).
// Counts from `from` (inclusive, default today) up to but not including 1 July 2027.
// Run with: node tools/working-days.js [YYYY-MM-DD]

const BANK_HOLIDAYS = [
  '2026-12-25', // Christmas Day
  '2026-12-28', // Boxing Day (substitute day)
  '2027-01-01', // New Year's Day
  '2027-03-26', // Good Friday
  '2027-03-29', // Easter Monday
  '2027-05-03', // Early May bank holiday
  '2027-05-31', // Spring bank holiday
];

const toKey = (d) => d.toISOString().slice(0, 10);

function workingDaysUntil(from = new Date(), to = new Date(Date.UTC(2027, 6, 1))) {
  const holidays = new Set(BANK_HOLIDAYS);
  const day = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  let count = 0;

  while (day < to) {
    const weekday = day.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const isDec30 = day.getUTCMonth() === 11 && day.getUTCDate() === 30;

    if (!isWeekend && !isDec30 && !holidays.has(toKey(day))) count++;
    day.setUTCDate(day.getUTCDate() + 1);
  }

  return count;
}

if (typeof module !== 'undefined') module.exports = { workingDaysUntil };

if (typeof require !== 'undefined' && require.main === module) {
  const arg = process.argv[2];
  const from = arg ? new Date(`${arg}T00:00:00`) : new Date();
  console.log(`${workingDaysUntil(from)} working days until 1 July 2027`);
}
