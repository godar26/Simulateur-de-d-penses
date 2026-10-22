const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../budget-core');

const entries = [
    { id: 'rent', name: 'Loyer', category: 'housing', amount: 900, date: '2026-10-02', type: 'expense' },
    { id: 'salary', name: 'Salaire', amount: 2500, date: '2026-10-01', type: 'income' },
    { id: 'groceries', name: 'Marché', category: 'food', amount: 120, date: '2026-10-10', type: 'expense' },
    { id: 'old', name: 'Ancien achat', category: 'food', amount: 20, date: '2026-09-30', type: 'expense' },
];

test('validates positive amounts and real ISO dates', () => {
    assert.equal(core.isValidAmount('12.50'), true);
    assert.equal(core.isValidAmount('0'), false);
    assert.equal(core.isValidAmount('-2'), false);
    assert.equal(core.isValidAmount(''), false);
    assert.equal(core.isValidDate('2026-10-22'), true);
    assert.equal(core.isValidDate('2026-02-30'), false);
});

test('summarizes one month without mixing income and expenses', () => {
    assert.deepEqual(core.summarizeMonth(entries, '2026-10', 0, 100), {
        income: 2500,
        expenses: 1020,
        savings: 100,
        available: 1380,
        incomeEntries: [entries[1]],
        expenseEntries: [entries[0], entries[2]],
    });
});

test('calculates category budget balances and overages', () => {
    const totals = core.categoryTotals(entries, {
        housing: { budget: 800 },
        food: { budget: 100 },
    }, '2026-10');
    assert.deepEqual(totals.housing, { spent: 900, budget: 800, remaining: 0, overBudget: true });
    assert.deepEqual(totals.food, { spent: 120, budget: 100, remaining: 0, overBudget: true });
});

test('filters by text, date, category, type and amount', () => {
    const result = core.filterTransactions(entries, {
        search: 'marche', from: '2026-10-05', to: '2026-10-31', category: 'food', type: 'expense',
        minimum: '100', maximum: '150', categories: { food: { label: 'Courses' } },
    });
    assert.deepEqual(result.map((entry) => entry.id), ['groceries']);
});

test('parses French CSV amounts, quoted cells and dates', () => {
    assert.equal(core.parseCsvAmount('1 234,56 DH'), 1234.56);
    assert.equal(core.parseCsvAmount('1,234.56'), 1234.56);
    assert.equal(core.parseCsvDate('22/10/2026'), '2026-10-22');
    assert.equal(core.parseCsvDate('31/02/2026'), '');
    assert.deepEqual(core.parseCsvRows('date;libellé;montant\n22/10/2026;"Café; du matin";12,50'), [
        ['date', 'libellé', 'montant'], ['22/10/2026', 'Café; du matin', '12,50'],
    ]);
});

test('formats MAD with the Moroccan French locale', () => {
    const formatter = core.currencyFormatter('MAD', true);
    assert.match(formatter.resolvedOptions().locale, /^fr-MA/);
    assert.match(formatter.format(1250.5), /MAD|DH/);
});
