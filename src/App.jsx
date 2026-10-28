import { useState, useEffect } from 'react';
import {
    PieChart, Pie, Cell, Tooltip, Legend,
    LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { ref, onValue, push, set, update, remove } from "firebase/database";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { db, auth, provider } from "./firebase";

// ---------- Helpers ----------
const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const formatINR = (value) => currencyFormatter.format(Math.round(Number(value || 0)));

const CATEGORIES = ['Food', 'Rent', 'Transport', 'Entertainment', 'Utilities', 'Shopping', 'Health', 'Other'];
const pieColors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

// Local dates (not UTC) so "today" is correct in India before 5:30 AM too
const toLocalISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => toLocalISO(new Date());
const parseLocalDate = (dateString) => {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, m - 1, d);
};
const startOfToday = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
};
const prettyDate = (dateString) =>
    dateString ? parseLocalDate(dateString).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const monthKey = (dateString) => (dateString || todayISO()).slice(0, 7); // "YYYY-MM"
const monthLabel = (key) => {
    const [year, month] = key.split('-').map(Number);
    const name = new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'short' });
    return `${name} '${String(year).slice(2)}`;
};
const lastNMonths = (n) => {
    const keys = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
        keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
    }
    return keys;
};

// Adds months without overflowing (e.g. 31 Jan + 1 month = 28/29 Feb)
const addMonths = (date, months) => {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return target;
};

// Subscriptions recur: if the saved renewal date has passed, roll it forward to the next billing date
const nextRenewalDate = (sub) => {
    if (!sub.nextRenewalDate) return null;
    let date = parseLocalDate(sub.nextRenewalDate);
    if (sub.isFreeTrial) return date; // a trial ends once; it doesn't repeat
    const step = sub.cycle === 'yearly' ? 12 : 1;
    const today = startOfToday();
    let guard = 0;
    while (date < today && guard < 600) {
        date = addMonths(date, step);
        guard++;
    }
    return date;
};
const daysUntilDate = (date) => (date ? Math.round((date - startOfToday()) / (1000 * 60 * 60 * 24)) : null);
const monthlyCostOf = (sub) => (sub.isFreeTrial ? 0 : sub.cycle === 'yearly' ? Number(sub.cost || 0) / 12 : Number(sub.cost || 0));

const snapshotToList = (snapshot) => {
    const data = snapshot.val();
    return data ? Object.keys(data).map((key) => ({ id: key, ...data[key] })) : [];
};

// ---------- Styles ----------
const font = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';
const card = { padding: '20px', border: '1px solid #e5e7eb', borderRadius: '12px', background: 'white', color: '#111827', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
const h1 = { margin: 0, fontSize: '28px', fontWeight: 800, color: '#111827' };
const h2 = { margin: '0 0 14px', fontSize: '19px', fontWeight: 700, color: '#111827' };
const input = { padding: '10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '15px', width: '100%', boxSizing: 'border-box', background: 'white', color: '#111827' };
const labelText = { fontSize: '13px', color: '#6b7280', display: 'block', marginBottom: '4px' };
const primaryBtn = { padding: '11px', background: '#111827', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px', fontWeight: 600 };
const smallBtn = { padding: '5px 12px', border: '1px solid #d1d5db', background: '#f9fafb', color: '#111827', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' };
const dangerBtn = { ...smallBtn, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c' };
const badge = (bg, color = '#111827') => ({ padding: '3px 9px', background: bg, color, borderRadius: '999px', fontSize: '12px', fontWeight: 600 });
const muted = { fontSize: '14px', color: '#6b7280' };

function StatTile({ label, value, note, tone = '#111827' }) {
    return (
        <div style={{ ...card, padding: '16px 18px' }}>
            <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: tone, margin: '6px 0 2px' }}>{value}</div>
            {note && <div style={{ fontSize: '13px', color: '#6b7280' }}>{note}</div>}
        </div>
    );
}

function App() {
    // --- AUTH ---
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);

    // --- DATA ---
    const [subscriptions, setSubscriptions] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [monthlyBudget, setMonthlyBudget] = useState(20000);
    const [categoryBudgets, setCategoryBudgets] = useState({});

    // --- SUBSCRIPTION FORM ---
    const [subName, setSubName] = useState('');
    const [subCost, setSubCost] = useState('');
    const [subCycle, setSubCycle] = useState('monthly');
    const [subRenewalDate, setSubRenewalDate] = useState('');
    const [subIsFreeTrial, setSubIsFreeTrial] = useState(false);
    const [editingSubId, setEditingSubId] = useState(null);

    // --- EXPENSE FORM ---
    const [expName, setExpName] = useState('');
    const [expAmount, setExpAmount] = useState('');
    const [expCategory, setExpCategory] = useState('Food');
    const [expDate, setExpDate] = useState(todayISO());
    const [editingExpId, setEditingExpId] = useState(null);

    // --- EXPENSE FILTERS ---
    const [search, setSearch] = useState('');
    const [filterCategory, setFilterCategory] = useState('All');
    const [filterMonth, setFilterMonth] = useState('current');

    // --- LOGIN STATUS ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setAuthLoading(false);
            if (!currentUser) {
                // Clear the previous user's data on sign-out
                setSubscriptions([]);
                setExpenses([]);
                setCategoryBudgets({});
                setMonthlyBudget(20000);
            }
        });
        return () => unsubscribe();
    }, []);

    // --- LIVE SYNC FOR THE SIGNED-IN USER ---
    useEffect(() => {
        if (!user) return;
        const base = `users/${user.uid}`;
        const unsubSubs = onValue(ref(db, `${base}/subscriptions`), (s) => setSubscriptions(snapshotToList(s)));
        const unsubExps = onValue(ref(db, `${base}/expenses`), (s) => setExpenses(snapshotToList(s)));
        const unsubSettings = onValue(ref(db, `${base}/settings`), (s) => {
            const settings = s.val() || {};
            if (settings.monthlyBudget != null) setMonthlyBudget(Number(settings.monthlyBudget));
            setCategoryBudgets(settings.categoryBudgets || {});
        });
        return () => { unsubSubs(); unsubExps(); unsubSettings(); };
    }, [user]);

    // --- CALCULATIONS (CURRENT MONTH) ---
    const now = new Date();
    const currentMonth = monthKey(todayISO());
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();

    const thisMonthExpenses = expenses.filter((e) => monthKey(e.date) === currentMonth);
    const monthlySubscriptions = subscriptions.reduce((t, s) => t + monthlyCostOf(s), 0);
    const yearlySubscriptions = monthlySubscriptions * 12;
    const totalExpensesThisMonth = thisMonthExpenses.reduce((t, e) => t + Number(e.amount || 0), 0);
    const spentThisMonth = monthlySubscriptions + totalExpensesThisMonth;

    // Subscriptions are a fixed monthly cost; only day-to-day expenses are projected forward.
    const projectedSpend = monthlySubscriptions + (totalExpensesThisMonth / dayOfMonth) * daysInMonth;
    const overBudgetBy = projectedSpend - monthlyBudget;
    const budgetLeft = monthlyBudget - spentThisMonth;

    const spentByCategory = CATEGORIES.reduce((acc, c) => ({ ...acc, [c]: 0 }), {});
    thisMonthExpenses.forEach((e) => {
        const c = CATEGORIES.includes(e.category) ? e.category : 'Other';
        spentByCategory[c] += Number(e.amount || 0);
    });
    const pieData = Object.entries(spentByCategory)
        .map(([name, value]) => ({ name, value }))
        .filter((d) => d.value > 0);

    const trendData = lastNMonths(6).map((key) => ({
        month: monthLabel(key),
        Expenses: expenses.filter((e) => monthKey(e.date) === key).reduce((t, e) => t + Number(e.amount || 0), 0),
    }));

    const subsWithRenewal = subscriptions
        .map((s) => {
            const next = nextRenewalDate(s);
            return { ...s, next, days: daysUntilDate(next) };
        })
        .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
    const upcomingRenewals = subsWithRenewal.filter((s) => s.days !== null && s.days >= 0 && s.days <= 7);

    const filteredExpenses = [...expenses]
        .filter((e) => filterMonth === 'all' || monthKey(e.date) === currentMonth)
        .filter((e) => filterCategory === 'All' || (e.category || 'Other') === filterCategory)
        .filter((e) => (e.name || '').toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const filteredTotal = filteredExpenses.reduce((t, e) => t + Number(e.amount || 0), 0);

    // --- AUTH ACTIONS ---
    const handleLogin = async () => {
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error('Login Error:', error);
            window.alert('Failed to log in. Please try again.');
        }
    };
    const handleLogout = () => signOut(auth);

    // --- SETTINGS ---
    const saveMonthlyBudget = (value) => {
        setMonthlyBudget(value);
        set(ref(db, `users/${user.uid}/settings/monthlyBudget`), value);
    };
    const saveCategoryBudget = (category, value) => {
        setCategoryBudgets((prev) => ({ ...prev, [category]: value }));
        set(ref(db, `users/${user.uid}/settings/categoryBudgets/${category}`), value);
    };

    // --- SUBSCRIPTIONS: CREATE / UPDATE / DELETE ---
    const resetSubForm = () => {
        setSubName(''); setSubCost(''); setSubCycle('monthly'); setSubRenewalDate(''); setSubIsFreeTrial(false); setEditingSubId(null);
    };

    const handleSubscriptionSubmit = async (e) => {
        e.preventDefault();
        if (!subName.trim()) return window.alert('Please enter a subscription name.');
        if (subCost === '' || Number(subCost) < 0) return window.alert('Please enter a valid cost.');
        if (!subRenewalDate) return window.alert('Please choose the next renewal date.');

        const data = { name: subName.trim(), cost: Number(subCost), cycle: subCycle, nextRenewalDate: subRenewalDate, isFreeTrial: subIsFreeTrial };
        try {
            if (editingSubId) {
                await update(ref(db, `users/${user.uid}/subscriptions/${editingSubId}`), data);
            } else {
                await set(push(ref(db, `users/${user.uid}/subscriptions`)), data);
            }
            resetSubForm();
        } catch (error) {
            console.error('Error saving subscription:', error);
            window.alert('Could not save the subscription. Please try again.');
        }
    };

    const startEditSubscription = (sub) => {
        setEditingSubId(sub.id);
        setSubName(sub.name || '');
        setSubCost(String(sub.cost ?? ''));
        setSubCycle(sub.cycle || 'monthly');
        setSubRenewalDate(sub.nextRenewalDate || '');
        setSubIsFreeTrial(Boolean(sub.isFreeTrial));
    };

    const deleteSubscription = async (sub) => {
        if (!window.confirm(`Delete subscription "${sub.name}"?`)) return;
        await remove(ref(db, `users/${user.uid}/subscriptions/${sub.id}`));
        if (editingSubId === sub.id) resetSubForm();
    };

    // --- EXPENSES: CREATE / UPDATE / DELETE ---
    const resetExpForm = () => {
        setExpName(''); setExpAmount(''); setExpCategory('Food'); setExpDate(todayISO()); setEditingExpId(null);
    };

    const handleExpenseSubmit = async (e) => {
        e.preventDefault();
        if (!expName.trim()) return window.alert('Please enter an expense name.');
        if (!expAmount || Number(expAmount) <= 0) return window.alert('Please enter an amount greater than zero.');

        const data = { name: expName.trim(), amount: Number(expAmount), category: expCategory, date: expDate || todayISO() };
        try {
            if (editingExpId) {
                await update(ref(db, `users/${user.uid}/expenses/${editingExpId}`), data);
            } else {
                await set(push(ref(db, `users/${user.uid}/expenses`)), data);
            }
            resetExpForm();
        } catch (error) {
            console.error('Error saving expense:', error);
            window.alert('Could not save the expense. Please try again.');
        }
    };

    const startEditExpense = (exp) => {
        setEditingExpId(exp.id);
        setExpName(exp.name || '');
        setExpAmount(String(exp.amount ?? ''));
        setExpCategory(CATEGORIES.includes(exp.category) ? exp.category : 'Other');
        setExpDate(exp.date || todayISO());
    };

    const deleteExpense = async (exp) => {
        if (!window.confirm(`Delete expense "${exp.name}"?`)) return;
        await remove(ref(db, `users/${user.uid}/expenses/${exp.id}`));
        if (editingExpId === exp.id) resetExpForm();
    };

    // --- CSV EXPORT ---
    const exportCSV = () => {
        const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['Type', 'Name', 'Category / Billing', 'Amount (INR)', 'Date'],
            ...[...expenses].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((e) => ['Expense', e.name, e.category, e.amount, e.date || '']),
            ...subscriptions.map((s) => ['Subscription', s.name, s.isFreeTrial ? 'Free Trial' : (s.cycle === 'yearly' ? 'Yearly' : 'Monthly'), s.cost, s.nextRenewalDate || '']),
        ];
        const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `sub-tracker-${todayISO()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    // --- UI: LOADING ---
    if (authLoading) {
        return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font, color: '#6b7280' }}>Loading...</div>;
    }

    // --- UI: LOGIN SCREEN ---
    if (!user) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: font, backgroundColor: '#f3f4f6', padding: '16px' }}>
                <div style={{ ...card, padding: '40px', textAlign: 'center', maxWidth: '440px' }}>
                    <h1 style={h1}>Sub-Tracker</h1>
                    <p style={{ color: '#4b5563', margin: '12px 0 20px', lineHeight: 1.5 }}>
                        Track your subscriptions and daily expenses, forecast your month-end spend, and get warned before you go over budget.
                    </p>
                    <ul style={{ textAlign: 'left', color: '#374151', margin: '0 0 24px', paddingLeft: '20px', lineHeight: 1.8, fontSize: '15px' }}>
                        <li>Renewal reminders before you get charged</li>
                        <li>Category budgets and spending charts</li>
                        <li>Private, real-time sync across your devices</li>
                    </ul>
                    <button onClick={handleLogin} style={{ ...primaryBtn, background: '#2563eb', padding: '12px 24px', fontSize: '16px' }}>
                        Sign in with Google
                    </button>
                </div>
            </div>
        );
    }

    // --- UI: DASHBOARD ---
    return (
        <div style={{ background: '#f3f4f6', minHeight: '100vh', fontFamily: font }}>
            <div style={{ padding: '24px 16px', maxWidth: '1200px', margin: '0 auto', color: '#111827' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
                    <div>
                        <h1 style={h1}>Sub-Tracker</h1>
                        <div style={muted}>{now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })} overview</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={muted}>{user.email}</span>
                        <button onClick={exportCSV} style={smallBtn}>Export CSV</button>
                        <button onClick={handleLogout} style={dangerBtn}>Log Out</button>
                    </div>
                </div>

                {/* Stat tiles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                    <StatTile label="Spent this month" value={formatINR(spentThisMonth)} note={`${formatINR(totalExpensesThisMonth)} expenses + ${formatINR(monthlySubscriptions)} subscriptions`} />
                    <StatTile label="Projected month-end" value={formatINR(projectedSpend)} tone={overBudgetBy > 0 ? '#b91c1c' : '#111827'} note={`Budget ${formatINR(monthlyBudget)}`} />
                    <StatTile label="Budget left" value={formatINR(budgetLeft)} tone={budgetLeft < 0 ? '#b91c1c' : '#047857'} note={`${daysInMonth - dayOfMonth} days left this month`} />
                    <StatTile label="Subscriptions / year" value={formatINR(yearlySubscriptions)} note={`${subscriptions.filter((s) => !s.isFreeTrial).length} paid, ${subscriptions.filter((s) => s.isFreeTrial).length} free trial`} />
                </div>

                {/* Budget + category chart */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                    <div style={card}>
                        <h2 style={h2}>Budget</h2>
                        <label style={labelText}>Monthly budget (₹)</label>
                        <input type="number" min="0" value={monthlyBudget} onChange={(e) => saveMonthlyBudget(Number(e.target.value))} style={input} />
                        {overBudgetBy > 0 ? (
                            <div style={{ marginTop: '14px', padding: '12px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', borderRadius: '8px', fontWeight: 700 }}>
                                Early warning: at this rate you'll exceed your budget by {formatINR(overBudgetBy)} this month.
                            </div>
                        ) : (
                            <div style={{ marginTop: '14px', padding: '12px', border: '1px solid #86efac', background: '#f0fdf4', color: '#166534', borderRadius: '8px', fontWeight: 700 }}>
                                On track: projected {formatINR(-overBudgetBy)} under budget.
                            </div>
                        )}
                        <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '18px 0 8px' }}>Renewing in the next 7 days</h3>
                        {upcomingRenewals.length === 0 ? (
                            <div style={muted}>Nothing renews this week.</div>
                        ) : (
                            <div style={{ display: 'grid', gap: '6px' }}>
                                {upcomingRenewals.map((s) => (
                                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                                        <span><strong>{s.name}</strong> · {s.days === 0 ? 'today' : `in ${s.days} day${s.days === 1 ? '' : 's'}`}</span>
                                        <span>{s.isFreeTrial ? 'Trial ends' : formatINR(s.cost)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={card}>
                        <h2 style={h2}>Spending by Category</h2>
                        {pieData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={280}>
                                <PieChart>
                                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} stroke={pieData.length > 1 ? '#fff' : 'none'} strokeWidth={2}>
                                        {pieData.map((entry) => <Cell key={entry.name} fill={pieColors[CATEGORIES.indexOf(entry.name) % pieColors.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={(value) => formatINR(value)} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>Add expenses to see the chart</div>
                        )}
                    </div>
                </div>

                {/* Trend */}
                <div style={{ ...card, marginBottom: '16px' }}>
                    <h2 style={h2}>Monthly Spending Trend</h2>
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="month" tick={{ fontSize: 13 }} />
                            <YAxis tick={{ fontSize: 13 }} tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                            <Tooltip formatter={(value) => formatINR(value)} />
                            <Line type="linear" dataKey="Expenses" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                {/* Category budgets */}
                <div style={{ ...card, marginBottom: '16px' }}>
                    <h2 style={h2}>Category Budgets</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
                        {CATEGORIES.map((c) => {
                            const limit = Number(categoryBudgets[c] || 0);
                            const spent = spentByCategory[c] || 0;
                            const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
                            const over = limit > 0 && spent > limit;
                            return (
                                <div key={c}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '15px' }}>
                                        <strong>{c}</strong>
                                        <span style={{ color: over ? '#b91c1c' : '#4b5563' }}>{formatINR(spent)}{limit > 0 && ` / ${formatINR(limit)}`}</span>
                                    </div>
                                    <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden', marginBottom: '8px' }}>
                                        <div style={{ width: `${pct}%`, height: '100%', background: over ? '#dc2626' : pct > 80 ? '#f59e0b' : '#10b981' }} />
                                    </div>
                                    <input type="number" min="0" placeholder="Set monthly limit (₹)" value={categoryBudgets[c] ?? ''} onChange={(e) => saveCategoryBudget(c, e.target.value === '' ? null : Number(e.target.value))} style={{ ...input, padding: '8px', fontSize: '14px' }} />
                                    {over && <div style={{ color: '#b91c1c', fontSize: '13px', marginTop: '4px' }}>Over limit by {formatINR(spent - limit)}</div>}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Lists */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                    <section style={card}>
                        <h2 style={h2}>Subscriptions</h2>
                        <form onSubmit={handleSubscriptionSubmit} style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
                            <input type="text" placeholder="Subscription name (e.g. Netflix)" value={subName} onChange={(e) => setSubName(e.target.value)} style={input} />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <input type="number" min="0" placeholder="Cost (₹)" value={subCost} onChange={(e) => setSubCost(e.target.value)} style={input} />
                                <select value={subCycle} onChange={(e) => setSubCycle(e.target.value)} style={input}>
                                    <option value="monthly">Monthly</option>
                                    <option value="yearly">Yearly</option>
                                </select>
                            </div>
                            <div>
                                <label style={labelText}>{subIsFreeTrial ? 'Trial end date' : 'Next renewal date'}</label>
                                <input type="date" value={subRenewalDate} onChange={(e) => setSubRenewalDate(e.target.value)} style={input} />
                            </div>
                            <label style={{ fontSize: '15px' }}><input type="checkbox" checked={subIsFreeTrial} onChange={(e) => setSubIsFreeTrial(e.target.checked)} /> Free trial</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button type="submit" style={{ ...primaryBtn, flex: 1 }}>{editingSubId ? 'Save Changes' : 'Add Subscription'}</button>
                                {editingSubId && <button type="button" onClick={resetSubForm} style={smallBtn}>Cancel</button>}
                            </div>
                        </form>
                        <div style={{ display: 'grid', gap: '10px' }}>
                            {subsWithRenewal.map((sub) => {
                                const trialEnded = sub.isFreeTrial && sub.days !== null && sub.days < 0;
                                return (
                                    <div key={sub.id} style={{ padding: '12px 14px', border: editingSubId === sub.id ? '2px solid #2563eb' : '1px solid #e5e7eb', borderRadius: '10px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                                            <strong style={{ fontSize: '16px' }}>{sub.name}</strong>
                                            <span style={{ fontWeight: 600 }}>{formatINR(sub.cost)}<span style={muted}>/{sub.cycle === 'yearly' ? 'year' : 'month'}</span></span>
                                        </div>
                                        <div style={{ ...muted, marginTop: '2px' }}>
                                            {sub.next ? `${sub.isFreeTrial ? 'Trial ends' : 'Renews'} ${prettyDate(toLocalISO(sub.next))}` : 'No renewal date (edit to add one)'}
                                        </div>
                                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                            {sub.isFreeTrial && <span style={badge('#eff6ff', '#1d4ed8')}>Free Trial</span>}
                                            {sub.days !== null && sub.days >= 0 && sub.days <= 7 && (
                                                <span style={badge('#fef2f2', '#b91c1c')}>{sub.days === 0 ? 'Renews today!' : `${sub.isFreeTrial ? 'Ends' : 'Renews'} in ${sub.days} day${sub.days === 1 ? '' : 's'}`}</span>
                                            )}
                                            {trialEnded && <span style={badge('#fff7ed', '#c2410c')}>Trial ended – cancel or mark as paid</span>}
                                            <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                                                <button onClick={() => startEditSubscription(sub)} style={smallBtn}>Edit</button>
                                                <button onClick={() => deleteSubscription(sub)} style={dangerBtn}>Delete</button>
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                            {subscriptions.length === 0 && <p style={{ ...muted, textAlign: 'center' }}>No subscriptions yet.</p>}
                        </div>
                    </section>

                    <section style={card}>
                        <h2 style={h2}>Expenses</h2>
                        <form onSubmit={handleExpenseSubmit} style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
                            <input type="text" placeholder="Expense name (e.g. Groceries)" value={expName} onChange={(e) => setExpName(e.target.value)} style={input} />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <input type="number" min="0" placeholder="Amount (₹)" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} style={input} />
                                <select value={expCategory} onChange={(e) => setExpCategory(e.target.value)} style={input}>
                                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} style={input} />
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button type="submit" style={{ ...primaryBtn, flex: 1 }}>{editingExpId ? 'Save Changes' : 'Add Expense'}</button>
                                {editingExpId && <button type="button" onClick={resetExpForm} style={smallBtn}>Cancel</button>}
                            </div>
                        </form>

                        {/* Filters */}
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                            <input type="search" placeholder="Search expenses" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...input, padding: '8px', fontSize: '14px' }} />
                            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ ...input, padding: '8px', fontSize: '14px' }}>
                                <option value="All">All</option>
                                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ ...input, padding: '8px', fontSize: '14px' }}>
                                <option value="current">This month</option>
                                <option value="all">All time</option>
                            </select>
                        </div>
                        <div style={{ ...muted, marginBottom: '10px' }}>{filteredExpenses.length} expense{filteredExpenses.length === 1 ? '' : 's'} · {formatINR(filteredTotal)}</div>

                        <div style={{ display: 'grid', gap: '10px' }}>
                            {filteredExpenses.map((exp) => (
                                <div key={exp.id} style={{ padding: '12px 14px', border: editingExpId === exp.id ? '2px solid #2563eb' : '1px solid #e5e7eb', borderRadius: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                                        <strong style={{ fontSize: '16px' }}>{exp.name}</strong>
                                        <span style={{ fontWeight: 600 }}>{formatINR(exp.amount)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', gap: '8px' }}>
                                        <span style={muted}>
                                            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: pieColors[Math.max(0, CATEGORIES.indexOf(exp.category))], marginRight: '6px' }} />
                                            {exp.category}{exp.date ? ` · ${prettyDate(exp.date)}` : ''}
                                        </span>
                                        <span style={{ display: 'flex', gap: '6px' }}>
                                            <button onClick={() => startEditExpense(exp)} style={smallBtn}>Edit</button>
                                            <button onClick={() => deleteExpense(exp)} style={dangerBtn}>Delete</button>
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {filteredExpenses.length === 0 && <p style={{ ...muted, textAlign: 'center' }}>{expenses.length === 0 ? 'No expenses yet.' : 'No expenses match these filters.'}</p>}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

export default App;
