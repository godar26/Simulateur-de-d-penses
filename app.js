import BudgetCore from './budget-core.js';
import { supabase, supabaseConfigured } from './supabase-client.js';

const STORAGE_KEY = 'clair-budget-v1';
const defaultCategories = {
    logement: { label: 'Logement & charges', icon: '⌂', budget: 1050, color: '#10b981' },
    courses: { label: 'Courses', icon: '▤', budget: 420, color: '#d6b15c' },
    transport: { label: 'Transport', icon: '↗', budget: 180, color: '#65a9c1' },
    maison: { label: 'Maison', icon: '⌑', budget: 140, color: '#72c4a6' },
    loisirs: { label: 'Loisirs', icon: '✳', budget: 200, color: '#df8c76' },
    sante: { label: 'Santé', icon: '+', budget: 100, color: '#90a4bd' },
};
const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
let euro;
let euroExact;
const dateLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

function dateThisMonth(day) {
    const date = new Date(today.getFullYear(), today.getMonth(), Math.min(day, today.getDate()));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function makeInitialState() {
    return {
        income: 2700,
        userName: '',
        currency: 'EUR',
        theme: 'dark',
        categories: Object.fromEntries(Object.entries(defaultCategories).map(([key, category]) => [key, { ...category }])),
        monthKey: currentMonth,
        monthSavings: 320,
        recurring: [],
        contributions: [],
        expenses: [
            { id: 'seed-1', name: 'Loyer', category: 'logement', amount: 890, date: dateThisMonth(2) },
            { id: 'seed-2', name: 'Marché des Lilas', category: 'courses', amount: 72.4, date: dateThisMonth(20) },
            { id: 'seed-3', name: 'Super U', category: 'courses', amount: 96.18, date: dateThisMonth(17) },
            { id: 'seed-4', name: 'Pass Navigo', category: 'transport', amount: 48.5, date: dateThisMonth(15) },
            { id: 'seed-5', name: 'Vélo en libre-service', category: 'transport', amount: 32, date: dateThisMonth(12) },
            { id: 'seed-6', name: 'Cinéma', category: 'loisirs', amount: 29.9, date: dateThisMonth(9) },
            { id: 'seed-7', name: 'Quincaillerie', category: 'maison', amount: 41.75, date: dateThisMonth(6) },
        ],
        goals: [
            { id: 'goal-1', name: 'Voyage en famille', current: 680, target: 1800 },
            { id: 'goal-2', name: 'Fonds de sécurité', current: 1250, target: 3000 },
        ],
    };
}

function isValidState(value) {
    return value && typeof value === 'object'
        && Number.isFinite(value.income) && value.income >= 0
        && Array.isArray(value.expenses) && Array.isArray(value.goals)
        && Number.isFinite(value.monthSavings) && value.monthSavings >= 0;
}

function normalizeState(value) {
    if (!isValidState(value)) return null;
    const stored = { ...value };
    stored.userName = typeof stored.userName === 'string' ? stored.userName.trim().slice(0, 40) : '';
    stored.currency = ['EUR', 'USD', 'XOF', 'MAD'].includes(stored.currency) ? stored.currency : 'EUR';
    stored.theme = stored.theme === 'light' ? 'light' : 'dark';
    const savedCategories = stored.categories && typeof stored.categories === 'object' && !Array.isArray(stored.categories)
        ? stored.categories
        : {};
    stored.categories = {
        ...Object.fromEntries(Object.entries(defaultCategories).map(([key, category]) => [key, { ...category }])),
        ...savedCategories,
    };
    stored.recurring = Array.isArray(stored.recurring) ? stored.recurring : [];
    stored.contributions = Array.isArray(stored.contributions) ? stored.contributions : [];
    if (stored.monthKey !== currentMonth) {
        stored.monthKey = currentMonth;
        stored.monthSavings = 0;
    }
    stored.expenses = stored.expenses.filter((expense) => expense && typeof expense.name === 'string'
        && Number.isFinite(expense.amount) && expense.amount > 0
        && (expense.type === 'income' || stored.categories[expense.category])
        && BudgetCore.isValidDate(expense.date))
        .map((expense) => ({ ...expense, type: expense.type === 'income' ? 'income' : 'expense' }));
    stored.goals = stored.goals.filter((goal) => goal && typeof goal.name === 'string'
        && Number.isFinite(goal.current) && Number.isFinite(goal.target) && goal.target > 0);
    stored.recurring = stored.recurring.filter((rule) => rule && typeof rule.name === 'string'
        && Number.isFinite(rule.amount) && rule.amount > 0 && Number.isInteger(rule.day)
        && ['income', 'expense'].includes(rule.type)
        && (rule.type === 'income' || stored.categories[rule.category]));
    stored.contributions = stored.contributions.filter((entry) => entry && Number.isFinite(entry.amount)
        && entry.amount > 0 && BudgetCore.isValidDate(entry.date));
    return stored;
}

function loadState() {
    try {
        return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))) || makeInitialState();
    } catch {
        return makeInitialState();
    }
}

let state = loadState();
let categories = state.categories;
let currentUser = null;
let cloudSyncTimer = null;
let cloudSyncPaused = false;
let authGeneration = 0;
let lastLoadedUserId = '';
function updateCurrencyFormatters() {
    euro = BudgetCore.currencyFormatter(state.currency);
    euroExact = BudgetCore.currencyFormatter(state.currency, true);
    const symbols = { EUR: '€', USD: '$', XOF: 'FCFA', MAD: 'DH' };
    document.querySelectorAll('.currency-symbol').forEach((element) => { element.textContent = symbols[state.currency]; });
}
updateCurrencyFormatters();
let toastTimer;
const byId = (id) => document.getElementById(id);
const expenseModal = byId('expense-modal');
const incomeModal = byId('income-modal');
const goalModal = byId('goal-modal');
const contributionModal = byId('contribution-modal');
const incomeEntryModal = byId('income-entry-modal');
const categoryModal = byId('category-modal');
const recurringModal = byId('recurring-modal');
const welcomeModal = byId('welcome-modal');
const accountModal = byId('account-modal');

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        queueCloudSync();
    } catch {
        showToast('Enregistrement local indisponible sur cet appareil.');
    }
}

const CLOUD_OWNER_KEY = `${STORAGE_KEY}-owner`;

function setCloudStatus(message, mode = '') {
    byId('account-status').textContent = message;
    const indicator = byId('cloud-indicator');
    indicator.classList.remove('is-ready', 'is-signed-in', 'is-syncing', 'is-error');
    if (mode) indicator.classList.add(`is-${mode}`);
}

function updateAccountView() {
    const emailInput = byId('account-email');
    const accountForm = byId('account-form');
    const signOutButton = byId('account-sign-out');
    byId('account-send-link').disabled = !supabaseConfigured;
    emailInput.disabled = !supabaseConfigured || Boolean(currentUser);
    accountForm.hidden = !supabaseConfigured || Boolean(currentUser);
    signOutButton.hidden = !currentUser;
    if (!supabaseConfigured) {
        byId('account-description').textContent = 'La synchronisation cloud n’est pas configurée. Ton budget reste enregistré sur cet appareil.';
        setCloudStatus('Configure les variables Supabase pour activer la synchronisation.');
    } else if (currentUser) {
        emailInput.value = currentUser.email || '';
        byId('account-description').textContent = `Connecté avec ${currentUser.email || 'ton compte'}.`;
        setCloudStatus('Synchronisation activée.', 'ready');
    } else {
        byId('account-description').textContent = 'Un lien de connexion sécurisé sera envoyé par e-mail.';
        setCloudStatus('Tes données restent locales jusqu’à la connexion.');
    }
}

function applySyncedState(nextState) {
    state = nextState;
    categories = state.categories;
    updateCurrencyFormatters();
    byId('currency-picker').value = state.currency;
    document.body.classList.toggle('light-mode', state.theme === 'light');
    byId('toggle-theme').textContent = state.theme === 'dark' ? '☼' : '☾';
    byId('toggle-theme').setAttribute('aria-label', state.theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
    renderGreeting();
    populateCategorySelect();
    render();
}

function queueCloudSync() {
    if (!supabaseConfigured || !currentUser || cloudSyncPaused) return;
    clearTimeout(cloudSyncTimer);
    setCloudStatus('Modifications en attente de synchronisation…', 'syncing');
    cloudSyncTimer = window.setTimeout(() => syncStateToCloud(currentUser.id), 700);
}

async function syncStateToCloud(userId) {
    if (!supabaseConfigured || !currentUser || currentUser.id !== userId || cloudSyncPaused) return;
    try {
        const { error } = await supabase.from('budget_state').upsert({
            user_id: userId,
            payload: state,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (currentUser?.id !== userId) return;
        if (error) throw error;
        localStorage.setItem(CLOUD_OWNER_KEY, userId);
        setCloudStatus('Budget synchronisé.', 'ready');
    } catch (error) {
        if (currentUser?.id !== userId) return;
        setCloudStatus('Échec de synchronisation. Les données locales sont conservées.', 'error');
    }
}

async function loadCloudState(user, generation) {
    if (!supabaseConfigured || !user) return;
    cloudSyncPaused = true;
    setCloudStatus('Chargement du budget cloud…', 'syncing');
    try {
        const { data, error } = await supabase.from('budget_state')
            .select('payload')
            .eq('user_id', user.id)
            .maybeSingle();
        if (error) throw error;
        if (authGeneration !== generation || currentUser?.id !== user.id) return;

        if (data?.payload) {
            const remoteState = normalizeState(data.payload);
            if (!remoteState) throw new Error('Le budget cloud n’a pas le format attendu.');
            applySyncedState(remoteState);
        } else if (localStorage.getItem(CLOUD_OWNER_KEY)
            && localStorage.getItem(CLOUD_OWNER_KEY) !== user.id) {
            applySyncedState(makeInitialState());
        }

        const { error: saveError } = await supabase.from('budget_state').upsert({
            user_id: user.id,
            payload: state,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (saveError) throw saveError;
        localStorage.setItem(CLOUD_OWNER_KEY, user.id);
        setCloudStatus('Budget synchronisé.', 'ready');
    } catch (error) {
        if (authGeneration === generation && currentUser?.id === user.id) {
            setCloudStatus(`Synchronisation impossible : ${error.message}. Le budget local est conservé.`, 'error');
        }
    } finally {
        if (authGeneration === generation) cloudSyncPaused = false;
    }
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

function monthExpenses() {
    return state.expenses.filter((expense) => expense.type !== 'income' && expense.date.startsWith(currentMonth));
}

function monthIncomes() {
    return monthlySummary().incomeEntries;
}

function monthIncome() {
    return monthlySummary().income;
}

function monthSpent() {
    return monthlySummary().expenses;
}

function availableBalance() {
    return monthlySummary().available;
}

function monthlySummary() {
    return BudgetCore.summarizeMonth(state.expenses, currentMonth, state.income, state.monthSavings);
}

function showToast(message) {
    const toast = byId('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

const animatedValues = new WeakMap();
function animateCurrency(element, value, formatter = euro) {
    const previous = animatedValues.get(element);
    animatedValues.set(element, value);
    if (!Number.isFinite(previous) || previous === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        element.textContent = formatter.format(value);
        return;
    }
    const start = performance.now();
    const duration = 420;
    element.classList.add('is-counting');
    const tick = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - ((1 - progress) ** 3);
        element.textContent = formatter.format(previous + ((value - previous) * eased));
        if (progress < 1) requestAnimationFrame(tick);
        else element.classList.remove('is-counting');
    };
    requestAnimationFrame(tick);
}

function renderCategories() {
    const totals = BudgetCore.categoryTotals(state.expenses, categories, currentMonth);
    const totalSpent = Object.values(totals).reduce((sum, amount) => sum + amount, 0);
    let degrees = 0;
    const segments = Object.entries(categories).flatMap(([key, category]) => {
        const amount = totals[key].spent;
        if (amount <= 0 || totalSpent <= 0) return [];
        const end = degrees + (amount / totalSpent) * 360;
        const segment = `${category.color} ${degrees}deg ${end}deg`;
        degrees = end;
        return [segment];
    });
    byId('spending-donut').style.background = segments.length
        ? `conic-gradient(from -90deg, ${segments.join(', ')})`
        : 'conic-gradient(from -90deg, #2b384b 0deg 360deg)';
    byId('donut-total').textContent = euro.format(totalSpent);
    const categorySummary = Object.entries(categories)
        .filter(([key]) => totals[key].spent > 0)
        .map(([key, category]) => `${category.label} ${Math.round((totals[key].spent / totalSpent) * 100)} %`);
    byId('spending-donut').setAttribute('aria-label', categorySummary.length
        ? `Répartition des dépenses : ${categorySummary.join(', ')}`
        : 'Aucune dépense enregistrée ce mois-ci');
    byId('category-list').innerHTML = Object.entries(categories).map(([key, category]) => {
        const { spent, budget, overBudget } = totals[key];
        const progress = budget > 0 ? Math.min(100, (spent / budget) * 100) : (spent > 0 ? 100 : 0);
        return `<div class="category-row">
      <div class="category-name"><span class="category-glyph" style="--category-color:${category.color}" aria-hidden="true">${category.icon}</span><span>${category.label}</span></div>
      <div class="category-total ${overBudget ? 'is-over-budget' : ''}">${euroExact.format(spent)}<small>${overBudget ? `Dépassement ${euroExact.format(spent - budget)}` : `sur ${euroExact.format(budget)}`}</small></div>
      <div class="category-meter ${overBudget ? 'is-over-budget' : ''}" role="progressbar" aria-label="Budget ${escapeHtml(category.label)}" aria-valuemin="0" aria-valuemax="${budget}" aria-valuenow="${Math.min(spent, budget)}"><span style="width:${progress}%"></span></div>
    </div>`;
    }).join('');
}

function renderBalanceChart() {
    const chartMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
    const monthKeys = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(today.getFullYear(), today.getMonth() - 5 + index, 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    });
    const points = monthKeys.map((monthKey, index) => {
        const entries = state.expenses.filter((entry) => entry.date.startsWith(monthKey));
        const income = state.income + entries.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + entry.amount, 0);
        const spent = entries.filter((entry) => entry.type !== 'income').reduce((sum, entry) => sum + entry.amount, 0);
        const savings = monthKey === currentMonth ? state.monthSavings
            : state.contributions.filter((entry) => entry.date.startsWith(monthKey)).reduce((sum, entry) => sum + entry.amount, 0);
        return { x: 40 + (700 * index) / (monthKeys.length - 1), value: income - savings - spent };
    });
    const values = points.map((point) => point.value);
    let minimum = Math.min(0, ...values);
    let maximum = Math.max(0, ...values);
    const spread = maximum - minimum || 1;
    minimum -= spread * .08;
    maximum += spread * .08;
    const plotTop = 22;
    const plotBottom = 178;
    points.forEach((point) => {
        point.y = plotBottom - ((point.value - minimum) / (maximum - minimum)) * (plotBottom - plotTop);
    });
    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const before = points[Math.max(0, index - 2)];
        const after = points[Math.min(points.length - 1, index + 1)];
        const controlOneX = previous.x + (current.x - before.x) / 6;
        const controlOneY = previous.y + (current.y - before.y) / 6;
        const controlTwoX = current.x - (after.x - previous.x) / 6;
        const controlTwoY = current.y - (after.y - previous.y) / 6;
        linePath += ` C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${current.x} ${current.y}`;
    }
    byId('balance-line').setAttribute('d', linePath);
    byId('balance-area').setAttribute('d', `${linePath} L ${points.at(-1).x} 186 L ${points[0].x} 186 Z`);
    byId('balance-marker').setAttribute('cx', String(points.at(-1).x));
    byId('balance-marker').setAttribute('cy', String(points.at(-1).y));
    byId('balance-glow').setAttribute('cx', String(points.at(-1).x));
    byId('balance-glow').setAttribute('cy', String(points.at(-1).y));
    byId('chart-period').textContent = '6 derniers mois';
    byId('chart-start-label').textContent = chartMonth.format(new Date(`${monthKeys[0]}-02`)).replace('.', '');
    byId('chart-middle-label').textContent = chartMonth.format(new Date(`${monthKeys[2]}-02`)).replace('.', '');
    byId('chart-end-label').textContent = chartMonth.format(new Date(`${currentMonth}-02`)).replace('.', '');
    byId('chart-description').textContent = `Évolution du solde estimé de ${euro.format(points[0].value)} en ${chartMonth.format(new Date(`${monthKeys[0]}-02`))} à ${euro.format(points.at(-1).value)} en ${chartMonth.format(new Date(`${currentMonth}-02`))}.`;
}

function renderTransactions() {
    const transactions = BudgetCore.filterTransactions(state.expenses, {
        search: byId('transaction-search').value,
        from: byId('filter-from').value,
        to: byId('filter-to').value,
        category: byId('filter-category').value,
        type: byId('filter-type').value,
        minimum: byId('filter-min').value,
        maximum: byId('filter-max').value,
        categories,
    });
    byId('expense-count').textContent = String(monthExpenses().length);
    byId('transaction-count').textContent = String(transactions.length);
    byId('expense-empty').hidden = transactions.length > 0;
    byId('transaction-list').hidden = transactions.length === 0;
    byId('transaction-list').innerHTML = transactions.map((entry) => {
        const isIncome = entry.type === 'income';
        const category = categories[entry.category];
        const categoryName = isIncome ? 'Revenu' : category?.label || 'Autre';
        const icon = isIncome ? '↗' : category?.icon || '•';
        return `<div class="transaction-row">
      <div class="transaction-main"><span class="transaction-glyph" aria-hidden="true">${icon}</span><div class="transaction-copy"><strong>${escapeHtml(entry.name)}</strong><span>${categoryName}</span></div></div>
      <time class="transaction-date" datetime="${entry.date}">${dateLabel.format(new Date(`${entry.date}T12:00:00`))}</time>
      <span class="transaction-amount ${isIncome ? 'income-amount' : ''}">${isIncome ? '+' : '−'}${euroExact.format(entry.amount)}</span>
      <button class="remove-expense" type="button" data-remove-expense="${escapeHtml(entry.id)}" aria-label="Supprimer ${escapeHtml(entry.name)}" title="Supprimer">×</button>
    </div>`;
    }).join('');
}

const parseCsvRows = BudgetCore.parseCsvRows;
const normalizeText = BudgetCore.normalizeText;
const parseCsvDate = BudgetCore.parseCsvDate;
const parseCsvAmount = BudgetCore.parseCsvAmount;

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTransactionsCsv() {
    const header = ['date', 'type', 'libelle', 'categorie', 'montant', 'devise'];
    const records = state.expenses.filter((entry) => entry.date.startsWith(currentMonth)).map((entry) => [
        entry.date,
        entry.type === 'income' ? 'revenu' : 'depense',
        entry.name,
        entry.type === 'income' ? 'Revenu' : categories[entry.category]?.label || 'Autre',
        entry.amount.toFixed(2),
        state.currency,
    ]);
    const escapeCell = (value) => `"${String(value).replace(/"/g, '""')}"`;
    downloadFile(`clair-bilan-${currentMonth}.csv`, `\uFEFF${[header, ...records].map((record) => record.map(escapeCell).join(';')).join('\r\n')}`, 'text/csv');
    showToast('Bilan CSV téléchargé.');
}

function exportMonthlyPdf() {
    const transactions = state.expenses.filter((entry) => entry.date.startsWith(currentMonth))
        .sort((a, b) => a.date.localeCompare(b.date));
    const totalIncome = monthIncome();
    const totalExpenses = monthSpent();
    const net = availableBalance();
    byId('print-title').textContent = monthLabel.format(new Date(`${currentMonth}-02`));
    byId('print-summary').textContent = `Revenus : ${euro.format(totalIncome)} · Dépenses : ${euro.format(totalExpenses)} · Reste à vivre : ${euro.format(net)}`;
    byId('print-rows').innerHTML = transactions.map((entry) => {
        const isIncome = entry.type === 'income';
        return `<tr><td>${entry.date}</td><td>${isIncome ? 'Revenu' : 'Dépense'}</td><td>${escapeHtml(entry.name)}</td><td>${isIncome ? 'Revenu' : escapeHtml(categories[entry.category]?.label || 'Autre')}</td><td>${isIncome ? '+' : '−'}${euroExact.format(entry.amount)}</td></tr>`;
    }).join('');
    window.print();
}

async function importTransactionsCsv(file) {
    const rows = parseCsvRows(await file.text());
    if (rows.length < 2) { showToast('Le fichier CSV doit contenir une ligne de titres et des transactions.'); return; }
    const headers = rows[0].map(normalizeText);
    const findColumn = (names) => headers.findIndex((header) => names.includes(header));
    const dateColumn = findColumn(['date', 'date operation', 'date de transaction']);
    const nameColumn = findColumn(['libelle', 'description', 'nom', 'operation', 'merchant']);
    const amountColumn = findColumn(['montant', 'amount', 'somme']);
    const debitColumn = findColumn(['debit', 'debit amount', 'sortie']);
    const creditColumn = findColumn(['credit', 'credit amount', 'entree']);
    const categoryColumn = findColumn(['categorie', 'category', 'poste']);
    const typeColumn = findColumn(['type', 'nature', 'sens']);
    if (dateColumn < 0 || nameColumn < 0 || (amountColumn < 0 && debitColumn < 0 && creditColumn < 0)) {
        showToast('Colonnes requises : date, libellé/description et montant ou débit/crédit.');
        return;
    }
    let imported = 0;
    rows.slice(1).forEach((row) => {
        const date = parseCsvDate(row[dateColumn] || '');
        const debit = debitColumn >= 0 ? parseCsvAmount(row[debitColumn] || '') : 0;
        const credit = creditColumn >= 0 ? parseCsvAmount(row[creditColumn] || '') : 0;
        const rawAmount = amountColumn >= 0 ? parseCsvAmount(row[amountColumn] || '') : (credit > 0 ? credit : -debit);
        const name = String(row[nameColumn] || '').trim();
        if (!date || !Number.isFinite(rawAmount) || rawAmount === 0 || !name) return;
        const rawType = normalizeText(row[typeColumn] || '');
        const rawCategory = String(row[categoryColumn] || '').trim();
        const type = /revenu|income|credit|versement/.test(rawType)
            || (!rawType && (credit > 0 || (amountColumn >= 0 && !rawCategory && rawAmount > 0))) ? 'income' : 'expense';
        const amount = Math.abs(rawAmount);
        let category = '';
        if (type === 'expense') {
            const label = rawCategory;
            const existing = Object.entries(categories).find(([key, value]) => normalizeText(key) === normalizeText(label) || normalizeText(value.label) === normalizeText(label));
            if (existing) category = existing[0];
            else if (label) {
                category = `${normalizeText(label).replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 5)}`;
                categories[category] = { label, icon: '•', color: '#90a4bd', budget: 0 };
            } else category = Object.keys(categories)[0];
        }
        state.expenses.push({ id: createId('import'), name, amount, date, type, category });
        imported += 1;
    });
    if (!imported) { showToast('Aucune transaction valide trouvée dans ce CSV.'); return; }
    state.categories = categories;
    populateCategorySelect();
    render();
    showToast(`${imported} transaction${imported > 1 ? 's' : ''} importée${imported > 1 ? 's' : ''}.`);
}

function goalMonthlyRate(goal) {
    const contributions = state.contributions.filter((entry) => entry.goalId === goal.id);
    if (contributions.length) {
        const byMonth = new Map();
        contributions.forEach((entry) => byMonth.set(entry.date.slice(0, 7), (byMonth.get(entry.date.slice(0, 7)) || 0) + entry.amount));
        return [...byMonth.values()].slice(-3).reduce((sum, amount) => sum + amount, 0) / Math.min(3, byMonth.size);
    }
    const activeGoals = Math.max(1, state.goals.filter((entry) => entry.current < entry.target).length);
    return (monthIncome() * .2) / activeGoals;
}

function applyRecurringTransactions() {
    const monthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    state.recurring.forEach((rule) => {
        const day = Math.min(rule.day, monthDays);
        if (day > today.getDate()) return;
        const id = `recurring-${rule.id}-${currentMonth}`;
        if (state.expenses.some((entry) => entry.id === id)) return;
        state.expenses.push({
            id,
            recurringId: rule.id,
            name: rule.name,
            amount: rule.amount,
            type: rule.type,
            category: rule.category,
            date: dateThisMonth(day),
        });
    });
}

function renderRecurring() {
    byId('recurring-list').innerHTML = state.recurring.length
        ? state.recurring.map((rule) => `<div class="recurring-row"><span class="recurring-kind ${rule.type}">${rule.type === 'income' ? '↗' : '↘'}</span><div class="recurring-copy"><strong>${escapeHtml(rule.name)}</strong><span>Chaque mois, le ${rule.day}${rule.day === 1 ? 'er' : ''}${rule.type === 'expense' ? ` · ${escapeHtml(categories[rule.category]?.label || 'Autre')}` : ' · Revenu'}</span></div><strong class="recurring-amount ${rule.type}">${rule.type === 'income' ? '+' : '−'}${euro.format(rule.amount)}</strong><button class="remove-expense" type="button" data-remove-recurring="${escapeHtml(rule.id)}" aria-label="Supprimer la récurrence ${escapeHtml(rule.name)}">×</button></div>`).join('')
        : '<div class="recurring-empty"><span aria-hidden="true">↻</span><p>Ajoute le loyer, un abonnement ou un revenu mensuel pour ne plus le ressaisir.</p></div>';
}

function renderScenario() {
    const percentage = Number(byId('scenario-cut').value);
    const saving = monthSpent() * (percentage / 100);
    byId('scenario-percent').textContent = `${percentage} %`;
    byId('scenario-savings').textContent = euro.format(saving);
    byId('scenario-note').textContent = percentage === 0
        ? 'Aucune réduction simulée.'
        : `Ton reste à vivre augmenterait de ${euro.format(saving)} ce mois-ci.`;
    byId('scenario-cut').style.setProperty('--range-progress', `${(percentage / 50) * 100}%`);
}

function renderGoals() {
    const goals = state.goals;
    byId('goal-list').innerHTML = goals.map((goal, index) => {
        const progress = Math.min(100, Math.round((goal.current / goal.target) * 100));
        const remaining = Math.max(0, goal.target - goal.current);
        const monthlyRate = goalMonthlyRate(goal);
        const monthsToGoal = monthlyRate > 0 ? Math.ceil(remaining / monthlyRate) : null;
        const projectedDate = monthsToGoal ? new Date(today.getFullYear(), today.getMonth() + monthsToGoal, 1) : null;
        const projection = remaining === 0 ? 'Objectif atteint !' : monthsToGoal
            ? `Dans ${monthsToGoal} mois · ${monthLabel.format(projectedDate)}`
            : 'Ajoute un versement pour voir la projection';
        return `<div class="goal-item">
      <div class="goal-topline"><div class="goal-title"><span class="goal-emblem" aria-hidden="true">${index % 2 === 0 ? '◎' : '⌂'}</span><span>${escapeHtml(goal.name)}</span></div><span class="goal-amount"><strong>${euro.format(goal.current)}</strong> / ${euro.format(goal.target)}</span></div>
      <div class="goal-meter" role="progressbar" aria-label="Progression ${escapeHtml(goal.name)}" aria-valuemin="0" aria-valuemax="${goal.target}" aria-valuenow="${Math.min(goal.current, goal.target)}"><span style="width:${progress}%"></span></div>
      <div class="goal-bottom"><span>${remaining > 0 ? `Encore ${euro.format(remaining)} · ${projection}` : projection}</span><span class="goal-actions"><button class="text-action" type="button" data-edit-goal="${escapeHtml(goal.id)}">Modifier</button><button class="text-action" type="button" data-contribute="${escapeHtml(goal.id)}" ${remaining === 0 ? 'disabled' : ''}>${remaining > 0 ? 'Verser +' : 'Terminé'}</button></span></div>
    </div>`;
    }).join('');
    byId('open-contribution').disabled = goals.length === 0 || goals.every((goal) => goal.current >= goal.target);
    byId('open-contribution').setAttribute('aria-disabled', String(byId('open-contribution').disabled));
}

function renderSummary() {
    const spent = monthSpent();
    const balance = availableBalance();
    const savingTarget = monthIncome() * 0.2;
    const savingRemaining = Math.max(0, savingTarget - state.monthSavings);
    const totalSaved = state.goals.reduce((total, goal) => total + goal.current, 0);
    const totalTarget = state.goals.reduce((total, goal) => total + goal.target, 0);
    const progress = totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 0;

    animateCurrency(byId('available-value'), balance);
    byId('available-value').classList.toggle('negative-value', balance < 0);
    animateCurrency(byId('expenses-value'), spent);
    byId('expense-detail').textContent = `${monthExpenses().length} mouvement${monthExpenses().length > 1 ? 's' : ''} ce mois-ci`;
    animateCurrency(byId('saving-value'), savingRemaining);
    byId('saving-detail').textContent = state.monthSavings > 0 ? `${euro.format(state.monthSavings)} déjà mis de côté` : '20 % de tes revenus';
    animateCurrency(byId('income-value'), monthIncome());
    animateCurrency(byId('saved-total'), totalSaved);
    byId('savings-track-fill').style.width = `${progress}%`;
    byId('saving-progress-label').textContent = totalTarget > 0 ? `${euro.format(totalSaved)} sur ${euro.format(totalTarget)}` : 'Crée un objectif pour commencer';
    byId('saving-percent').textContent = `${progress} %`;
    byId('recommendation-title').textContent = savingRemaining === 0 ? 'Bravo, objectif atteint !' : `Encore ${euro.format(savingRemaining)} à épargner`;
    byId('recommendation-copy').textContent = savingRemaining === 0
        ? 'Tu as atteint ton repère de 20 % ce mois-ci.'
        : `Ton repère mensuel est de ${euro.format(savingTarget)} (20 % des revenus).`;
}

function render() {
    renderSummary();
    renderCategories();
    renderBalanceChart();
    renderTransactions();
    renderGoals();
    renderRecurring();
    renderScenario();
    saveState();
}

function populateCategorySelect() {
    const options = Object.entries(categories).map(([key, category]) => `<option value="${escapeHtml(key)}">${escapeHtml(category.label)}</option>`).join('');
    byId('expense-category').innerHTML = options;
    byId('recurring-category').innerHTML = options;
    byId('filter-category').innerHTML = `<option value="">Toutes les catégories</option>${options}`;
    const selected = byId('category-existing').value;
    byId('category-existing').innerHTML = Object.entries(categories)
        .map(([key, category]) => `<option value="${escapeHtml(key)}">${escapeHtml(category.label)}</option>`).join('');
    if (categories[selected]) byId('category-existing').value = selected;
}

function fillCategoryForm(key) {
    const category = categories[key];
    byId('category-existing').value = category ? key : '';
    byId('category-name').value = category?.label || '';
    const icon = category?.icon || '✳';
    const iconSelect = byId('category-icon');
    if (![...iconSelect.options].some((option) => option.value === icon)) {
        iconSelect.add(new Option(`${icon} Personnalisée`, icon));
    }
    iconSelect.value = icon;
    byId('category-color').value = category?.color || '#10b981';
    byId('category-budget').value = String(category?.budget ?? 0);
    byId('delete-category').disabled = !category;
}

function populateGoalSelect(selectedId) {
    const availableGoals = state.goals.filter((goal) => goal.current < goal.target);
    byId('contribution-goal').innerHTML = availableGoals.length
        ? availableGoals.map((goal) => `<option value="${escapeHtml(goal.id)}" ${goal.id === selectedId ? 'selected' : ''}>${escapeHtml(goal.name)} · ${euro.format(goal.target - goal.current)} restants</option>`).join('')
        : '<option value="">Aucun objectif à compléter</option>';
    byId('contribution-amount').max = availableBalance() > 0 ? availableBalance().toFixed(2) : '0';
    byId('contribution-hint').textContent = availableBalance() > 0
        ? `Reste à vivre disponible : ${euroExact.format(availableBalance())}.`
        : 'Ajoute un revenu ou ajuste tes dépenses avant un versement.';
}

function openModal(modal) {
    if (!modal.open) modal.showModal();
}

function closeModal(modal) {
    if (modal.open) modal.close();
}

function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function setMonthLabels() {
    const label = monthLabel.format(new Date(`${currentMonth}-02`));
    const capitalized = label.charAt(0).toLocaleUpperCase('fr-FR') + label.slice(1);
    byId('sidebar-month').textContent = capitalized;
    byId('topbar-month').textContent = capitalized;
}

function renderGreeting() {
    const name = state.userName.trim();
    const initial = name ? Array.from(name)[0].toLocaleUpperCase('fr-MA') : 'M';
    byId('greeting-title').textContent = name
        ? `Bonjour ${name}, bienvenue chez vous.`
        : 'Bonjour bienvenue chez vous.';
    byId('edit-name').textContent = initial;
    document.querySelector('.profile .avatar').textContent = initial;
    document.querySelector('.profile-copy strong').textContent = name || 'Mon foyer';
}

populateCategorySelect();
setMonthLabels();
renderGreeting();
byId('currency-picker').value = state.currency;
byId('filter-from').value = `${currentMonth}-01`;
byId('filter-to').value = dateThisMonth(today.getDate());
byId('filter-from').max = dateThisMonth(today.getDate());
byId('filter-to').max = dateThisMonth(today.getDate());
document.body.classList.toggle('light-mode', state.theme === 'light');
byId('toggle-theme').textContent = state.theme === 'dark' ? '☼' : '☾';
byId('toggle-theme').setAttribute('aria-label', state.theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
applyRecurringTransactions();
render();
fillCategoryForm(Object.keys(categories)[0]);
updateAccountView();

byId('open-expense').addEventListener('click', () => {
    byId('expense-date').min = dateThisMonth(1);
    byId('expense-date').max = dateThisMonth(today.getDate());
    byId('expense-date').value = dateThisMonth(today.getDate());
    openModal(expenseModal);
    byId('expense-name').focus();
});
byId('open-income-entry').addEventListener('click', () => {
    byId('income-entry-date').value = dateThisMonth(today.getDate());
    openModal(incomeEntryModal);
});
byId('open-expense-secondary').addEventListener('click', () => byId('open-expense').click());
byId('empty-add-expense').addEventListener('click', () => byId('open-expense').click());
byId('edit-income').addEventListener('click', () => {
    byId('income-amount').value = state.income.toFixed(2);
    openModal(incomeModal);
    byId('income-amount').focus();
});
byId('account-button').addEventListener('click', () => {
    openModal(accountModal);
});
byId('account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!supabaseConfigured) return;
    const email = String(new FormData(event.currentTarget).get('email')).trim();
    if (!email) return;
    byId('account-send-link').disabled = true;
    setCloudStatus('Envoi du lien de connexion…', 'syncing');
    try {
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setCloudStatus('Lien envoyé. Consulte ta boîte e-mail pour connecter ce compte.');
    } catch (error) {
        setCloudStatus(`Impossible d’envoyer le lien : ${error.message}`, 'error');
    } finally {
        byId('account-send-link').disabled = false;
    }
});
byId('account-sign-out').addEventListener('click', async () => {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        closeModal(accountModal);
    } catch (error) {
        setCloudStatus(`Déconnexion impossible : ${error.message}`, 'error');
    }
});
byId('edit-name').addEventListener('click', () => {
    byId('welcome-name').value = state.userName;
    openModal(welcomeModal);
    byId('welcome-name').focus();
});
byId('account-button').addEventListener('click', () => openModal(accountModal));
byId('account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!supabaseConfigured) return;
    const email = String(new FormData(event.currentTarget).get('email')).trim();
    if (!email) return;
    byId('account-send-link').disabled = true;
    setCloudStatus('Envoi du lien de connexion…', 'syncing');
    const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
    });
    byId('account-send-link').disabled = false;
    if (error) {
        setCloudStatus(`Impossible d’envoyer le lien : ${error.message}`, 'error');
        return;
    }
    setCloudStatus('Lien envoyé. Consulte ta boîte e-mail pour connecter ce compte.');
});
byId('account-sign-out').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setCloudStatus(`Déconnexion impossible : ${error.message}`, 'error');
    else closeModal(accountModal);
});
byId('currency-picker').addEventListener('change', (event) => {
    state.currency = event.currentTarget.value;
    updateCurrencyFormatters();
    render();
});
byId('toggle-theme').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.body.classList.toggle('light-mode', state.theme === 'light');
    byId('toggle-theme').textContent = state.theme === 'dark' ? '☼' : '☾';
    byId('toggle-theme').setAttribute('aria-label', state.theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
    saveState();
});
byId('scenario-cut').addEventListener('input', renderScenario);
['transaction-search', 'filter-from', 'filter-to', 'filter-category', 'filter-type', 'filter-min', 'filter-max']
    .forEach((id) => byId(id).addEventListener('input', renderTransactions));
byId('open-category-settings').addEventListener('click', () => {
    populateCategorySelect();
    fillCategoryForm(byId('category-existing').value || Object.keys(categories)[0]);
    openModal(categoryModal);
});
byId('category-existing').addEventListener('change', (event) => fillCategoryForm(event.currentTarget.value));
byId('new-category').addEventListener('click', () => {
    byId('category-existing').value = '';
    fillCategoryForm('');
    byId('category-name').focus();
});
byId('delete-category').addEventListener('click', () => {
    const key = byId('category-existing').value;
    if (!key) return;
    if (state.expenses.some((entry) => entry.category === key) || state.recurring.some((rule) => rule.category === key)) {
        showToast('Cette catégorie est utilisée par des transactions.');
        return;
    }
    delete categories[key];
    state.categories = categories;
    populateCategorySelect();
    fillCategoryForm(Object.keys(categories)[0]);
    updateAccountView();
    render();
    showToast('Catégorie supprimée.');
});
byId('open-recurring').addEventListener('click', () => openModal(recurringModal));
byId('open-recurring-secondary').addEventListener('click', () => openModal(recurringModal));
byId('recurring-type').addEventListener('change', (event) => {
    byId('recurring-category').disabled = event.currentTarget.value === 'income';
});
byId('recurring-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-recurring]');
    if (!button) return;
    state.recurring = state.recurring.filter((rule) => rule.id !== button.dataset.removeRecurring);
    render();
    showToast('Récurrence supprimée.');
});
byId('export-csv').addEventListener('click', exportTransactionsCsv);
byId('export-pdf').addEventListener('click', exportMonthlyPdf);
byId('import-csv-button').addEventListener('click', () => byId('import-csv-file').click());
byId('import-csv-file').addEventListener('change', async (event) => {
    const [file] = event.currentTarget.files;
    if (!file) return;
    try {
        await importTransactionsCsv(file);
    } catch {
        showToast('Impossible de lire ce fichier CSV.');
    }
    event.currentTarget.value = '';
});
byId('open-goal').addEventListener('click', () => openModal(goalModal));
byId('open-goal-secondary').addEventListener('click', () => openModal(goalModal));
byId('open-contribution').addEventListener('click', () => {
    populateGoalSelect();
    if (state.goals.some((goal) => goal.current < goal.target) && availableBalance() > 0) openModal(contributionModal);
    else showToast('Vérifie ton reste à vivre et tes objectifs avant un versement.');
});

byId('welcome-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    if (!name) {
        byId('welcome-name').focus();
        return;
    }
    state.userName = name.slice(0, 40);
    renderGreeting();
    saveState();
    closeModal(welcomeModal);
    showToast(`Bienvenue, ${state.userName} !`);
});

byId('expense-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount'));
    const date = String(form.get('date'));
    const category = String(form.get('category'));
    const name = String(form.get('name')).trim();
    if (!name || !BudgetCore.isValidAmount(amount) || !categories[category] || !BudgetCore.isValidDate(date)) return;
    state.expenses.push({ id: createId('expense'), name, category, amount, date });
    render();
    event.currentTarget.reset();
    closeModal(expenseModal);
    showToast(date.startsWith(currentMonth) ? 'Dépense ajoutée au suivi.' : 'Dépense enregistrée.');
});

byId('income-entry-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount'));
    const date = String(form.get('date'));
    const name = String(form.get('name')).trim();
    if (!name || !BudgetCore.isValidAmount(amount) || !BudgetCore.isValidDate(date)) return;
    state.expenses.push({ id: createId('income'), name, amount, date, type: 'income' });
    render();
    event.currentTarget.reset();
    closeModal(incomeEntryModal);
    showToast('Revenu ajouté au suivi.');
});

byId('income-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const income = Number(new FormData(event.currentTarget).get('income'));
    if (!Number.isFinite(income) || income < 0) return;
    state.income = income;
    render();
    closeModal(incomeModal);
    showToast('Revenu mensuel mis à jour.');
});

byId('goal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const target = Number(form.get('target'));
    if (!name || !Number.isFinite(target) || target <= 0) return;
    state.goals.push({ id: createId('goal'), name, current: 0, target });
    render();
    event.currentTarget.reset();
    closeModal(goalModal);
    showToast('Objectif créé. À toi de jouer !');
});

byId('goal-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-edit-goal]');
    if (!button) return;
    const goal = state.goals.find((entry) => entry.id === button.dataset.editGoal);
    if (!goal) return;
    byId('edit-goal-id').value = goal.id;
    byId('edit-goal-name').value = goal.name;
    byId('edit-goal-current').value = goal.current;
    byId('edit-goal-target').value = goal.target;
    openModal(byId('edit-goal-modal'));
});

byId('edit-goal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const goal = state.goals.find((entry) => entry.id === form.get('id'));
    const name = String(form.get('name')).trim();
    const current = Number(form.get('current'));
    const target = Number(form.get('target'));
    if (!goal || !name || !Number.isFinite(current) || current < 0 || !Number.isFinite(target) || target <= 0) return;
    goal.name = name;
    goal.current = current;
    goal.target = target;
    render();
    closeModal(byId('edit-goal-modal'));
    showToast('Objectif mis à jour.');
});

byId('delete-goal').addEventListener('click', () => {
    const id = byId('edit-goal-id').value;
    const goal = state.goals.find((entry) => entry.id === id);
    if (!goal) return;
    if (!window.confirm(`Supprimer l’objectif « ${goal.name} » et son historique de versements ?`)) return;
    state.goals = state.goals.filter((entry) => entry.id !== id);
    state.contributions = state.contributions.filter((entry) => entry.goalId !== id);
    render();
    closeModal(byId('edit-goal-modal'));
    showToast('Objectif supprimé.');
});

byId('category-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existingKey = byId('category-existing').value;
    const name = String(form.get('name')).trim();
    const budget = Number(form.get('budget'));
    if (!name || !Number.isFinite(budget) || budget < 0) return;
    const key = existingKey || `${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 5)}`;
    categories[key] = { label: name, icon: String(form.get('icon')).trim() || '•', color: String(form.get('color')), budget };
    state.categories = categories;
    populateCategorySelect();
    fillCategoryForm(key);
    render();
    showToast(existingKey ? 'Catégorie mise à jour.' : 'Catégorie créée.');
});

byId('recurring-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get('type'));
    const amount = Number(form.get('amount'));
    const day = Number(form.get('day'));
    const category = String(form.get('category'));
    const name = String(form.get('name')).trim();
    if (!name || !BudgetCore.isValidAmount(amount) || !Number.isInteger(day) || day < 1 || day > 31
        || !['income', 'expense'].includes(type) || (type === 'expense' && !categories[category])) return;
    state.recurring.push({ id: createId('rule'), name, amount, day, type, category: type === 'expense' ? category : '' });
    applyRecurringTransactions();
    render();
    event.currentTarget.reset();
    byId('recurring-category').disabled = false;
    closeModal(recurringModal);
    showToast('Récurrence enregistrée.');
});

byId('contribution-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const goal = state.goals.find((entry) => entry.id === form.get('goal'));
    const amount = Number(form.get('amount'));
    if (!goal || !BudgetCore.isValidAmount(amount)) return;
    if (amount > availableBalance()) {
        showToast('Ce versement dépasse ton reste à vivre.');
        return;
    }
    if (amount > goal.target - goal.current) {
        showToast('Ce versement dépasse le montant restant pour cet objectif.');
        return;
    }
    goal.current += amount;
    state.monthSavings += amount;
    state.contributions.push({ goalId: goal.id, amount, date: dateThisMonth(today.getDate()) });
    render();
    event.currentTarget.reset();
    closeModal(contributionModal);
    showToast('Versement ajouté à ton épargne.');
});

byId('goal-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-contribute]');
    if (!button) return;
    populateGoalSelect(button.dataset.contribute);
    if (availableBalance() > 0) openModal(contributionModal);
    else showToast('Ton reste à vivre ne permet pas de versement pour le moment.');
});

byId('transaction-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-expense]');
    if (!button) return;
    state.expenses = state.expenses.filter((expense) => expense.id !== button.dataset.removeExpense);
    render();
    showToast('Dépense supprimée.');
});

document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.closest('dialog')));
});
document.querySelectorAll('dialog').forEach((modal) => {
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal(modal);
    });
});

document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
        document.querySelectorAll('.nav-link').forEach((item) => {
            item.classList.remove('is-active');
            item.removeAttribute('aria-current');
        });
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
    });
});

updateAccountView();
if (supabaseConfigured) {
    supabase.auth.onAuthStateChange((event, session) => {
        const nextUser = session?.user || null;
        if (!nextUser) {
            currentUser = null;
            authGeneration += 1;
            lastLoadedUserId = '';
            cloudSyncPaused = false;
            updateAccountView();
            return;
        }

        const userChanged = currentUser?.id !== nextUser.id;
        currentUser = nextUser;
        updateAccountView();
        if (userChanged || lastLoadedUserId !== nextUser.id || event === 'SIGNED_IN') {
            authGeneration += 1;
            lastLoadedUserId = nextUser.id;
            const generation = authGeneration;
            window.setTimeout(() => loadCloudState(nextUser, generation), 0);
        }
    });
}
window.addEventListener('online', queueCloudSync);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./service-worker.js').catch(() => { });
}

const appLoader = byId('app-loader');
const loaderDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520;
window.setTimeout(() => {
    appLoader.classList.add('is-hidden');
    appLoader.setAttribute('aria-hidden', 'true');
    appLoader.style.opacity = '0';
    appLoader.style.pointerEvents = 'none';
    window.setTimeout(() => appLoader.remove(), loaderDelay ? 300 : 0);
}, loaderDelay);
if (!state.userName) {
    window.setTimeout(() => {
        openModal(welcomeModal);
        requestAnimationFrame(() => byId('welcome-name').focus());
    }, loaderDelay + (loaderDelay ? 300 : 0));
}
