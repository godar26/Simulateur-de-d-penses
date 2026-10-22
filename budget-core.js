const BudgetCore = (() => {
    function isValidAmount(value) {
        const amount = Number(value);
        return Number.isFinite(amount) && amount > 0;
    }

    function isValidDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    }

    function summarizeMonth(entries, monthKey, baseIncome, monthSavings) {
        const monthlyEntries = entries.filter((entry) => entry.date.startsWith(monthKey));
        const incomeEntries = monthlyEntries.filter((entry) => entry.type === 'income');
        const expenseEntries = monthlyEntries.filter((entry) => entry.type !== 'income');
        const income = Number(baseIncome) + incomeEntries.reduce((sum, entry) => sum + entry.amount, 0);
        const expenses = expenseEntries.reduce((sum, entry) => sum + entry.amount, 0);
        const savings = Number(monthSavings) || 0;
        return { income, expenses, savings, available: income - expenses - savings, incomeEntries, expenseEntries };
    }

    function categoryTotals(entries, categories, monthKey) {
        const totals = Object.fromEntries(Object.keys(categories).map((key) => [key, 0]));
        entries.filter((entry) => entry.type !== 'income' && entry.date.startsWith(monthKey))
            .forEach((entry) => {
                if (Object.hasOwn(totals, entry.category)) totals[entry.category] += entry.amount;
            });
        return Object.fromEntries(Object.entries(categories).map(([key, category]) => {
            const spent = totals[key];
            const budget = Number(category.budget) || 0;
            return [key, { spent, budget, remaining: Math.max(0, budget - spent), overBudget: spent > budget }];
        }));
    }

    function normalizeText(value) {
        return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').trim();
    }

    function filterTransactions(entries, options = {}) {
        const query = normalizeText(options.search || '');
        const minimum = options.minimum === '' || options.minimum == null ? 0 : Number(options.minimum);
        const maximum = options.maximum === '' || options.maximum == null ? Infinity : Number(options.maximum);
        return entries.filter((entry) => {
            const categoryLabel = entry.type === 'income' ? 'revenu' : options.categories?.[entry.category]?.label || '';
            const matchesSearch = !query || normalizeText(`${entry.name} ${categoryLabel}`).includes(query);
            const matchesType = !options.type || (entry.type === 'income' ? 'income' : 'expense') === options.type;
            return matchesSearch && matchesType
                && (!options.from || entry.date >= options.from)
                && (!options.to || entry.date <= options.to)
                && (!options.category || entry.category === options.category)
                && entry.amount >= minimum && entry.amount <= maximum;
        }).sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
    }

    function currencyFormatter(currency, exact = false) {
        const locale = currency === 'MAD' ? 'fr-MA' : 'fr-FR';
        const digits = currency === 'XOF' ? 0 : (exact ? 2 : 0);
        return new Intl.NumberFormat(locale, {
            style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
        });
    }

    function parseCsvRows(text) {
        const firstLine = text.split(/\r?\n/, 1)[0];
        const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
        const rows = [];
        let row = [];
        let cell = '';
        let quoted = false;
        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
            else if (character === '"') quoted = !quoted;
            else if (character === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
            else if ((character === '\n' || character === '\r') && !quoted) {
                if (character === '\r' && text[index + 1] === '\n') index += 1;
                row.push(cell.trim());
                if (row.some(Boolean)) rows.push(row);
                row = [];
                cell = '';
            } else cell += character;
        }
        row.push(cell.trim());
        if (row.some(Boolean)) rows.push(row);
        return rows;
    }

    function parseCsvAmount(value) {
        let text = String(value).replace(/[^\d,.-]/g, '');
        if (text.includes(',') && text.includes('.')) {
            if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
            else text = text.replace(/,/g, '');
        } else if (text.includes(',')) text = text.replace(',', '.');
        return Number(text);
    }

    function parseCsvDate(value) {
        const text = String(value).trim();
        if (isValidDate(text)) return text;
        const french = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
        if (!french) return '';
        const date = `${french[3]}-${french[2].padStart(2, '0')}-${french[1].padStart(2, '0')}`;
        return isValidDate(date) ? date : '';
    }

    return Object.freeze({
        isValidAmount,
        isValidDate,
        summarizeMonth,
        categoryTotals,
        normalizeText,
        filterTransactions,
        currencyFormatter,
        parseCsvRows,
        parseCsvAmount,
        parseCsvDate,
    });
})();

globalThis.BudgetCore = BudgetCore;
export default BudgetCore;
