import { useState, useEffect } from 'react';
import {
    PieChart, Pie, Cell, Tooltip, Legend,
    BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { ref, onValue, push, set, update, remove } from "firebase/database";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { db, auth, provider } from "./firebase";

// ---------- Constants ----------
const CATEGORIES = ['Food', 'Rent', 'Transport', 'Entertainment', 'Utilities', 'Shopping', 'Health', 'Other'];
const CATEGORY_COLORS = {
    Food: '#2e86ab', Rent: '#0f4c45', Transport: '#7b5ea7', Entertainment: '#d16ba5',
    Utilities: '#4c9f70', Shopping: '#c9822b', Health: '#c23b2e', Other: '#7a8b87',
};
const QUICK_PICKS = ['Netflix', 'Spotify', 'Amazon Prime', 'YouTube Premium', 'JioHotstar', 'ChatGPT Plus'];
const MARK_COLORS = ['#0f4c45', '#2e86ab', '#7b5ea7', '#c9822b', '#d16ba5', '#4c9f70', '#1f4e79'];

// ---------- Helpers ----------
const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const formatINR = (value) => currencyFormatter.format(Math.round(Number(value || 0)));

// Local dates (not UTC) so "today" is correct in India before 5:30 AM too
const toLocalISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => toLocalISO(new Date());
const parseLocalDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};
const startOfToday = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
};
const prettyDate = (date) => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const monthKey = (s) => (s || todayISO()).slice(0, 7);
const monthShort = (key) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short' });
};
const lastNMonths = (n) => {
    const d = new Date();
    return Array.from({ length: n }, (_, i) => {
        const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
        return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    });
};

// Adds months without overflowing (31 Jan + 1 month = 28/29 Feb)
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
    if (sub.isFreeTrial) return date; // a trial ends once
    const step = sub.cycle === 'yearly' ? 12 : 1;
    const today = startOfToday();
    for (let i = 0; date < today && i < 600; i++) date = addMonths(date, step);
    return date;
};
const daysUntil = (date) => (date ? Math.round((date - startOfToday()) / 86400000) : null);
const trialHasEnded = (sub) => sub.isFreeTrial && sub.nextRenewalDate && parseLocalDate(sub.nextRenewalDate) < startOfToday();
// Free trials cost nothing until they end; after that the service is charging you
const monthlyCostOf = (sub) => {
    if (sub.isFreeTrial && !trialHasEnded(sub)) return 0;
    return sub.cycle === 'yearly' ? Number(sub.cost || 0) / 12 : Number(sub.cost || 0);
};
const isPermissionError = (error) => String(error?.code || error?.message || '').toUpperCase().includes('PERMISSION_DENIED');
const whenText = (days) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);
const markColor = (name = '') => MARK_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % MARK_COLORS.length];

const snapshotToList = (snapshot) => {
    const data = snapshot.val();
    return data ? Object.keys(data).map((key) => ({ id: key, ...data[key] })) : [];
};

const greeting = () => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const authErrorMessage = (code) => {
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'The Google window was closed before sign-in finished. Try again when you\'re ready.';
    if (code === 'auth/popup-blocked') return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.';
    if (code === 'auth/network-request-failed') return 'Couldn\'t reach Google. Check your internet connection and try again.';
    if (code === 'auth/unauthorized-domain') return 'Sign-in isn\'t enabled for this web address yet. Add it under Firebase → Authentication → Authorized domains.';
    return `Sign-in didn't work (${code || 'unknown error'}). Please try again.`;
};

// ---------- Small components ----------
const Icon = ({ name }) => {
    const paths = {
        plus: <path d="M12 5v14M5 12h14" />,
        edit: <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3" />,
        trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
        download: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />,
        logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
        close: <path d="M6 6l12 12M18 6 6 18" />,
    };
    return (
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {paths[name]}
        </svg>
    );
};

const BrandMark = ({ className = 'brand-mark' }) => (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="12" fill="#0f4c45" />
        <path d="M28.5 15.5A10 10 0 1 0 30 21" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="29" cy="12.5" r="3.2" fill="#e9a21b" />
    </svg>
);

const GoogleG = () => (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
);

// Signature element: one bar per day of the month, renewal days raised in marigold
function Ribbon({ daysInMonth, today, chargeDays, light = false, monthName }) {
    const charges = new Set(chargeDays);
    const todayPos = ((today - 0.5) / daysInMonth) * 100;
    return (
        <div className={`ribbon${light ? ' on-light' : ''}`} role="img" aria-label={`${monthName}: ${charges.size} renewal${charges.size === 1 ? '' : 's'} this month, today is day ${today}`}>
            <div className="ribbon-days">
                {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const isCharge = charges.has(day);
                    const cls = isCharge ? `charge${day < today ? ' paid' : ''}` : day === today ? 'today' : day < today ? 'past' : '';
                    return <span key={day} className={`ribbon-day ${cls}`} title={isCharge ? `Renewal on ${day} ${monthName}` : undefined} />;
                })}
            </div>
            <div className="ribbon-scale">
                <span style={{ visibility: today <= 4 ? 'hidden' : 'visible' }}>1 {monthName}</span>
                <span className="ribbon-today" style={{ left: `${todayPos}%` }}>Today</span>
                <span style={{ visibility: today >= daysInMonth - 4 ? 'hidden' : 'visible' }}>{daysInMonth} {monthName}</span>
            </div>
        </div>
    );
}

function Modal({ title, onClose, children }) {
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
                <div className="panel-head" style={{ marginBottom: 0 }}>
                    <h2>{title}</h2>
                    <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

// ---------- Landing page (signed out) ----------
function Landing({ onLogin, signingIn, authError }) {
    const now = new Date();
    const monthName = now.toLocaleString('en-IN', { month: 'short' });
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const today = now.getDate();
    const sample = [
        { name: 'Netflix', offset: 2, cost: 649 },
        { name: 'Spotify', offset: 6, cost: 119 },
        { name: 'Amazon Prime', offset: 11, cost: 1499 },
    ].map((s) => ({ ...s, date: new Date(now.getFullYear(), now.getMonth(), today + s.offset) }));
    const chargeDays = [...sample.map((s) => s.date).filter((d) => d.getMonth() === now.getMonth()).map((d) => d.getDate()), 4].filter((d) => d !== today);

    return (
        <div className="landing">
            <header className="landing-top">
                <span className="brand"><BrandMark />Sub-Tracker</span>
                <button className="btn btn-sm" onClick={onLogin} disabled={signingIn}>Sign in</button>
            </header>

            <main>
                <section className="landing-hero">
                    <div>
                        <h1>See every renewal before it charges you.</h1>
                        <p className="landing-lede">
                            Sub-Tracker keeps your subscriptions and daily spending in one place, forecasts where your month will end, and warns you while there's still time to change it.
                        </p>
                        <div className="landing-cta">
                            <button className="btn google-btn" onClick={onLogin} disabled={signingIn}>
                                {signingIn ? <span className="spinner" /> : <span className="g"><GoogleG /></span>}
                                {signingIn ? 'Waiting for Google…' : 'Continue with Google'}
                            </button>
                            {authError ? (
                                <p className="auth-error" role="alert">{authError}</p>
                            ) : (
                                <p className="fine">Free to use. Your data is private to your Google account.</p>
                            )}
                        </div>
                    </div>

                    <div className="preview" aria-label="Example of the Sub-Tracker dashboard">
                        <div className="preview-head">
                            <h2>{now.toLocaleString('en-IN', { month: 'long' })} so far</h2>
                            <span className="sub">Example</span>
                        </div>
                        <div className="preview-big num">₹14,280</div>
                        <div className="sub">On track for ₹19,640 of your ₹20,000 budget</div>
                        <Ribbon daysInMonth={daysInMonth} today={today} chargeDays={chargeDays} monthName={monthName} />
                        <div className="preview-list">
                            {sample.map((s) => (
                                <div className="preview-row" key={s.name}>
                                    <span><strong>{s.name}</strong> <span className="when">{whenText(s.offset)}</span></span>
                                    <span className="num">{formatINR(s.cost)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="points">
                    <div>
                        <h3>Renewal alerts</h3>
                        <p>See what renews in the next 7 days and catch free trials before they turn into charges.</p>
                    </div>
                    <div>
                        <h3>Month-end forecast</h3>
                        <p>Your spending pace projected to the end of the month, with a warning while you can still adjust.</p>
                    </div>
                    <div>
                        <h3>Category budgets</h3>
                        <p>Set limits for food, rent, transport and more, and watch each one fill up as you spend.</p>
                    </div>
                </section>
            </main>

            <footer className="landing-foot">
                <span>Built with React and Firebase by Shrishail G Biradar</span>
                <a href="https://github.com/Shrishailgb24/sub-tracker" target="_blank" rel="noreferrer">View the code on GitHub</a>
            </footer>
        </div>
    );
}

// ---------- App ----------
function App() {
    // Auth
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [signingIn, setSigningIn] = useState(false);
    const [authError, setAuthError] = useState('');

    // Data
    const [subscriptions, setSubscriptions] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [monthlyBudget, setMonthlyBudget] = useState(20000);
    const [categoryBudgets, setCategoryBudgets] = useState({});

    // UI
    const [modal, setModal] = useState(null); // 'sub' | 'exp' | null
    const [toast, setToast] = useState(null); // { message, undo }
    const [editingBudget, setEditingBudget] = useState(false);
    const [budgetDraft, setBudgetDraft] = useState('');
    const [budgetError, setBudgetError] = useState('');
    const [limitDrafts, setLimitDrafts] = useState({});
    const [editingLimits, setEditingLimits] = useState(false);
    const [formError, setFormError] = useState('');

    // Subscription form
    const [subName, setSubName] = useState('');
    const [subCost, setSubCost] = useState('');
    const [subCycle, setSubCycle] = useState('monthly');
    const [subRenewalDate, setSubRenewalDate] = useState('');
    const [subIsFreeTrial, setSubIsFreeTrial] = useState(false);
    const [editingSubId, setEditingSubId] = useState(null);

    // Expense form
    const [expName, setExpName] = useState('');
    const [expAmount, setExpAmount] = useState('');
    const [expCategory, setExpCategory] = useState('Food');
    const [expDate, setExpDate] = useState(todayISO());
    const [editingExpId, setEditingExpId] = useState(null);

    // Expense filters
    const [search, setSearch] = useState('');
    const [filterCategory, setFilterCategory] = useState('All');
    const [filterMonth, setFilterMonth] = useState('current');

    // --- Login status ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setAuthLoading(false);
            if (!currentUser) {
                setSubscriptions([]);
                setExpenses([]);
                setCategoryBudgets({});
                setMonthlyBudget(20000);
            }
        });
        return () => unsubscribe();
    }, []);

    // --- Live sync for the signed-in user ---
    useEffect(() => {
        if (!user) return;
        const base = `users/${user.uid}`;
        const onLoadError = (what) => (error) => {
            console.error(`Error loading ${what}:`, error);
            setToast({
                error: true,
                message: isPermissionError(error)
                    ? `Couldn't load your ${what}: the Firebase database rules are blocking it. Publish the rules from database.rules.json.`
                    : `Couldn't load your ${what}. Check your internet connection and refresh.`,
            });
        };
        const unsubSubs = onValue(ref(db, `${base}/subscriptions`), (s) => setSubscriptions(snapshotToList(s)), onLoadError('subscriptions'));
        const unsubExps = onValue(ref(db, `${base}/expenses`), (s) => setExpenses(snapshotToList(s)), onLoadError('expenses'));
        const unsubSettings = onValue(ref(db, `${base}/settings`), (s) => {
            const settings = s.val() || {};
            setMonthlyBudget(settings.monthlyBudget != null ? Number(settings.monthlyBudget) : 20000);
            setCategoryBudgets(settings.categoryBudgets || {});
        }, onLoadError('budget settings'));
        return () => { unsubSubs(); unsubExps(); unsubSettings(); };
    }, [user]);

    // --- Toast auto-hide ---
    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), toast.error ? 12000 : 6000);
        return () => clearTimeout(timer);
    }, [toast]);

    // --- Calculations (current month) ---
    const now = new Date();
    const monthName = now.toLocaleString('en-IN', { month: 'short' });
    const currentMonth = monthKey(todayISO());
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();

    const thisMonthExpenses = expenses.filter((e) => monthKey(e.date) === currentMonth);
    const monthlySubscriptions = subscriptions.reduce((t, s) => t + monthlyCostOf(s), 0);
    const totalExpensesThisMonth = thisMonthExpenses.reduce((t, e) => t + Number(e.amount || 0), 0);
    const spentThisMonth = monthlySubscriptions + totalExpensesThisMonth;
    const projectedSpend = monthlySubscriptions + (totalExpensesThisMonth / dayOfMonth) * daysInMonth;
    const overBudgetBy = projectedSpend - monthlyBudget;
    const budgetLeft = monthlyBudget - spentThisMonth;
    const meterMax = Math.max(monthlyBudget, projectedSpend, 1);

    const spentByCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    thisMonthExpenses.forEach((e) => {
        const c = CATEGORIES.includes(e.category) ? e.category : 'Other';
        spentByCategory[c] += Number(e.amount || 0);
    });
    const pieData = CATEGORIES.map((name) => ({ name, value: spentByCategory[name] })).filter((d) => d.value > 0);

    const trendData = lastNMonths(6).map((key) => ({
        key,
        month: monthShort(key),
        Spent: expenses.filter((e) => monthKey(e.date) === key).reduce((t, e) => t + Number(e.amount || 0), 0),
    }));

    const subsWithRenewal = subscriptions
        .map((s) => {
            const next = nextRenewalDate(s);
            return { ...s, next, days: daysUntil(next) };
        })
        .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
    const upcoming = subsWithRenewal.filter((s) => s.days !== null && s.days >= 0 && s.days <= 7);
    const inThisMonth = (d) => d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const chargeDaysThisMonth = subsWithRenewal.flatMap((s) => {
        if (!s.next) return [];
        if (s.isFreeTrial) return inThisMonth(s.next) && s.days >= 0 ? [s.next.getDate()] : [];
        // This month's billing date: the next renewal, or the previous one if it already happened this month
        const previous = addMonths(s.next, s.cycle === 'yearly' ? -12 : -1);
        return [s.next, previous].filter(inThisMonth).map((d) => d.getDate());
    });

    const filteredExpenses = expenses
        .filter((e) => filterMonth === 'all' || monthKey(e.date) === currentMonth)
        .filter((e) => filterCategory === 'All' || (e.category || 'Other') === filterCategory)
        .filter((e) => (e.name || '').toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const filteredTotal = filteredExpenses.reduce((t, e) => t + Number(e.amount || 0), 0);

    // --- Auth actions ---
    const handleLogin = async () => {
        setAuthError('');
        setSigningIn(true);
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error('Login Error:', error);
            setAuthError(authErrorMessage(error?.code));
        } finally {
            setSigningIn(false);
        }
    };
    const handleLogout = () => signOut(auth);

    // --- Errors from database writes ---
    const showWriteError = (action, error) => {
        console.error(`Couldn't ${action}:`, error);
        setToast({
            error: true,
            message: isPermissionError(error)
                ? `Couldn't ${action}: the Firebase database rules are blocking it. Publish the rules from database.rules.json.`
                : `Couldn't ${action}. Check your internet connection and try again.`,
        });
    };

    // --- Settings ---
    const startEditingBudget = () => {
        setBudgetDraft(String(monthlyBudget));
        setBudgetError('');
        setEditingBudget(true);
    };
    const saveBudget = async () => {
        const value = Math.round(Number(budgetDraft));
        if (!budgetDraft || !Number.isFinite(value) || value <= 0) {
            setBudgetError('Enter a budget greater than ₹0.');
            return;
        }
        const previous = monthlyBudget;
        setMonthlyBudget(value); // show it straight away
        setEditingBudget(false);
        try {
            await set(ref(db, `users/${user.uid}/settings/monthlyBudget`), value);
            setToast({ message: `Monthly budget set to ${formatINR(value)}` });
        } catch (error) {
            setMonthlyBudget(previous); // put the old value back if it didn't save
            showWriteError('save your budget', error);
        }
    };
    const commitCategoryLimit = async (category) => {
        if (!(category in limitDrafts)) return;
        const raw = limitDrafts[category];
        const value = raw === '' ? null : Math.round(Number(raw));
        setLimitDrafts((prev) => {
            const rest = { ...prev };
            delete rest[category];
            return rest;
        });
        if (value !== null && (!Number.isFinite(value) || value < 0)) return;
        if ((categoryBudgets[category] ?? null) === value) return;
        const previous = categoryBudgets;
        setCategoryBudgets((prev) => ({ ...prev, [category]: value }));
        try {
            await set(ref(db, `users/${user.uid}/settings/categoryBudgets/${category}`), value);
            setToast({ message: value === null ? `${category} limit removed` : `${category} limit set to ${formatINR(value)}` });
        } catch (error) {
            setCategoryBudgets(previous);
            showWriteError(`save the ${category} limit`, error);
        }
    };

    // --- Subscriptions ---
    const openNewSubscription = () => {
        setEditingSubId(null); setSubName(''); setSubCost(''); setSubCycle('monthly'); setSubRenewalDate(''); setSubIsFreeTrial(false);
        setFormError(''); setModal('sub');
    };
    const openEditSubscription = (sub) => {
        setEditingSubId(sub.id); setSubName(sub.name || ''); setSubCost(String(sub.cost ?? '')); setSubCycle(sub.cycle || 'monthly');
        setSubRenewalDate(sub.nextRenewalDate || ''); setSubIsFreeTrial(Boolean(sub.isFreeTrial));
        setFormError(''); setModal('sub');
    };
    const closeModal = () => { setModal(null); setEditingSubId(null); setEditingExpId(null); };

    const handleSubscriptionSubmit = async (e) => {
        e.preventDefault();
        if (!subName.trim()) return setFormError('Add a name, for example Netflix.');
        if (subCost === '' || Number(subCost) < 0) return setFormError('Add the price you pay each billing cycle.');
        if (!subRenewalDate) return setFormError(subIsFreeTrial ? 'Add the date your free trial ends.' : 'Add the date it next renews.');

        const data = { name: subName.trim(), cost: Number(subCost), cycle: subCycle, nextRenewalDate: subRenewalDate, isFreeTrial: subIsFreeTrial };
        try {
            if (editingSubId) await update(ref(db, `users/${user.uid}/subscriptions/${editingSubId}`), data);
            else await set(push(ref(db, `users/${user.uid}/subscriptions`)), data);
            setToast({ message: editingSubId ? `${data.name} updated` : `${data.name} added` });
            closeModal();
        } catch (error) {
            console.error('Error saving subscription:', error);
            setFormError(isPermissionError(error) ? 'Couldn\'t save: the Firebase database rules are blocking it.' : 'Couldn\'t save. Check your internet connection and try again.');
        }
    };

    const deleteSubscription = async (sub) => {
        const { id, name, cost, cycle, nextRenewalDate: renewal, isFreeTrial } = sub;
        const path = `users/${user.uid}/subscriptions/${id}`;
        try {
            await remove(ref(db, path));
            setToast({ message: `${name} deleted`, undo: () => set(ref(db, path), { name, cost, cycle: cycle || 'monthly', nextRenewalDate: renewal || '', isFreeTrial: Boolean(isFreeTrial) }) });
        } catch (error) {
            showWriteError(`delete ${name}`, error);
        }
    };

    // --- Expenses ---
    const openNewExpense = () => {
        setEditingExpId(null); setExpName(''); setExpAmount(''); setExpCategory('Food'); setExpDate(todayISO());
        setFormError(''); setModal('exp');
    };
    const openEditExpense = (exp) => {
        setEditingExpId(exp.id); setExpName(exp.name || ''); setExpAmount(String(exp.amount ?? ''));
        setExpCategory(CATEGORIES.includes(exp.category) ? exp.category : 'Other'); setExpDate(exp.date || todayISO());
        setFormError(''); setModal('exp');
    };

    const handleExpenseSubmit = async (e) => {
        e.preventDefault();
        if (!expName.trim()) return setFormError('Add what you spent on, for example Groceries.');
        if (!expAmount || Number(expAmount) <= 0) return setFormError('Add an amount greater than zero.');

        const data = { name: expName.trim(), amount: Number(expAmount), category: expCategory, date: expDate || todayISO() };
        try {
            if (editingExpId) await update(ref(db, `users/${user.uid}/expenses/${editingExpId}`), data);
            else await set(push(ref(db, `users/${user.uid}/expenses`)), data);
            setToast({ message: editingExpId ? 'Expense updated' : `${formatINR(data.amount)} added to ${data.category}` });
            closeModal();
        } catch (error) {
            console.error('Error saving expense:', error);
            setFormError(isPermissionError(error) ? 'Couldn\'t save: the Firebase database rules are blocking it.' : 'Couldn\'t save. Check your internet connection and try again.');
        }
    };

    const deleteExpense = async (exp) => {
        const { id, name, amount, category, date } = exp;
        const path = `users/${user.uid}/expenses/${id}`;
        try {
            await remove(ref(db, path));
            setToast({ message: `${name} deleted`, undo: () => set(ref(db, path), { name, amount, category: category || 'Other', date: date || todayISO() }) });
        } catch (error) {
            showWriteError(`delete ${name}`, error);
        }
    };

    // --- CSV export ---
    const exportCSV = () => {
        const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['Type', 'Name', 'Category / Billing', 'Amount (INR)', 'Date'],
            ...[...expenses].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((e) => ['Expense', e.name, e.category, e.amount, e.date || '']),
            ...subscriptions.map((s) => ['Subscription', s.name, s.isFreeTrial ? 'Free trial' : (s.cycle === 'yearly' ? 'Yearly' : 'Monthly'), s.cost, s.nextRenewalDate || '']),
        ];
        const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `sub-tracker-${todayISO()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        setToast({ message: 'CSV downloaded' });
    };

    // ---------- Screens ----------
    if (authLoading) {
        return (
            <div className="splash" role="status">
                <BrandMark />
                <span>Opening Sub-Tracker…</span>
            </div>
        );
    }

    if (!user) return <Landing onLogin={handleLogin} signingIn={signingIn} authError={authError} />;

    const firstName = (user.displayName || user.email || '').split(/[ @]/)[0];

    return (
        <div className="app">
            {/* Top bar */}
            <header className="topbar">
                <span className="brand"><BrandMark />Sub-Tracker</span>
                <div className="topbar-actions">
                    <button className="btn btn-ghost btn-sm" onClick={exportCSV}><Icon name="download" />Export CSV</button>
                    {user.photoURL
                        ? <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                        : <span className="avatar" aria-hidden="true">{firstName.charAt(0).toUpperCase()}</span>}
                    <span className="user-name fine">{user.displayName || user.email}</span>
                    <button className="btn btn-ghost btn-sm" onClick={handleLogout}><Icon name="logout" />Log out</button>
                </div>
            </header>

            <div className="greeting">
                <h1>{greeting()}, {firstName}</h1>
                <p>{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}. {daysInMonth - dayOfMonth} days left in {now.toLocaleString('en-IN', { month: 'long' })}.</p>
            </div>

            <div className="grid">
                {/* Summary */}
                <section className="panel summary span-7" aria-label="This month's spending">
                    <div className="label">Spent in {now.toLocaleString('en-IN', { month: 'long' })} so far</div>
                    <div className="summary-big num">{formatINR(spentThisMonth)}</div>

                    <div className="meter" aria-hidden="true">
                        <div className="meter-fill" style={{ width: `${Math.min(100, (spentThisMonth / meterMax) * 100)}%` }} />
                        {projectedSpend > monthlyBudget && <div className="meter-budget" style={{ left: `${(monthlyBudget / meterMax) * 100}%` }} />}
                        <div className="meter-proj" style={{ left: `calc(${Math.min(100, (projectedSpend / meterMax) * 100)}% - 1px)` }} />
                    </div>
                    <div className="meter-legend">
                        <span><span className="key" />Projected {formatINR(projectedSpend)}</span>
                        <span>Budget {formatINR(monthlyBudget)}</span>
                    </div>
                    {editingBudget ? (
                        <form className="budget-edit" onSubmit={(e) => { e.preventDefault(); saveBudget(); }}>
                            <label htmlFor="budget-input" className="budget-label">Monthly budget (₹)</label>
                            <div className="budget-row">
                                <input id="budget-input" type="number" min="1" step="1" inputMode="numeric" autoFocus value={budgetDraft}
                                    style={{ color: '#13201d', background: '#fff' }}
                                    onChange={(e) => { setBudgetDraft(e.target.value); setBudgetError(''); }}
                                    onKeyDown={(e) => e.key === 'Escape' && setEditingBudget(false)} />
                                <button className="btn btn-sm" type="submit">Save budget</button>
                                <button className="btn btn-sm btn-on-dark" type="button" onClick={() => setEditingBudget(false)}>Cancel</button>
                            </div>
                            {budgetError && <p className="budget-error" role="alert">{budgetError}</p>}
                        </form>
                    ) : (
                        <button className="btn btn-sm btn-on-dark budget-btn" onClick={startEditingBudget}><Icon name="edit" />Edit monthly budget</button>
                    )}

                    <div className={`forecast ${overBudgetBy > 0 ? 'over' : 'ok'}`}>
                        {overBudgetBy > 0
                            ? `At this pace you'll spend ${formatINR(projectedSpend)} by ${daysInMonth} ${monthName}, ${formatINR(overBudgetBy)} over budget. Slow down on day-to-day spending to stay on track.`
                            : `At this pace you'll finish the month around ${formatINR(projectedSpend)}, ${formatINR(-overBudgetBy)} under budget.`}
                        {dayOfMonth < 5 && <span className="forecast-note"> The forecast gets more accurate after the first few days of the month.</span>}
                    </div>

                    <div className="mini-stats">
                        <div><strong className="num">{formatINR(Math.max(0, budgetLeft))}</strong>{budgetLeft < 0 ? `over by ${formatINR(-budgetLeft)}` : 'left to spend'}</div>
                        <div><strong className="num">{formatINR(monthlySubscriptions)}</strong>subscriptions a month</div>
                        <div><strong className="num">{formatINR(monthlySubscriptions * 12)}</strong>subscriptions a year</div>
                    </div>
                </section>

                {/* Renewals */}
                <section className="panel renewals span-5">
                    <div className="panel-head"><h2>Renewals this month</h2></div>
                    <Ribbon daysInMonth={daysInMonth} today={dayOfMonth} chargeDays={chargeDaysThisMonth} light monthName={monthName} />
                    {upcoming.length > 0 ? (
                        <ul className="renewal-list">
                            {upcoming.map((s) => (
                                <li key={s.id}>
                                    <span><strong>{s.name}</strong><br /><span className="when">{s.isFreeTrial ? 'Free trial ends' : 'Renews'} {whenText(s.days).toLowerCase()}</span></span>
                                    <span className="num">{s.isFreeTrial ? `then ${formatINR(s.cost)}` : formatINR(s.cost)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="empty">Nothing renews in the next 7 days.</p>
                    )}
                </section>

                {/* Category donut */}
                <section className="panel span-5">
                    <div className="panel-head"><h2>Where it went</h2></div>
                    {pieData.length > 0 ? (
                        <div className="donut-wrap">
                            <ResponsiveContainer width="100%" height={270}>
                                <PieChart>
                                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={68} outerRadius={100} stroke={pieData.length > 1 ? '#fff' : 'none'} strokeWidth={3}>
                                        {pieData.map((d) => <Cell key={d.name} fill={CATEGORY_COLORS[d.name]} />)}
                                    </Pie>
                                    <Tooltip formatter={(v) => formatINR(v)} />
                                    <Legend iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="donut-center"><div><strong className="num">{formatINR(totalExpensesThisMonth)}</strong><span>this month</span></div></div>
                        </div>
                    ) : (
                        <div className="empty-state"><p>Add an expense to see where your money goes.</p><button className="btn btn-primary btn-sm" onClick={openNewExpense}><Icon name="plus" />Add expense</button></div>
                    )}
                </section>

                {/* Trend */}
                <section className="panel span-7">
                    <div className="panel-head"><h2>Last 6 months</h2><span className="fine">Day-to-day expenses</span></div>
                    <ResponsiveContainer width="100%" height={270}>
                        <BarChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="#e8eeeb" />
                            <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 13, fill: '#5d6c67' }} />
                            <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 13, fill: '#5d6c67' }} tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                            <Tooltip cursor={{ fill: '#f2f5f3' }} formatter={(v) => formatINR(v)} />
                            <Bar dataKey="Spent" radius={[8, 8, 0, 0]} maxBarSize={46}>
                                {trendData.map((d) => <Cell key={d.key} fill={d.key === currentMonth ? '#0f4c45' : '#9fc5bb'} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </section>

                {/* Subscriptions */}
                <section className="panel span-6">
                    <div className="panel-head">
                        <h2>Subscriptions<span className="count">{subscriptions.length}</span></h2>
                        <button className="btn btn-primary btn-sm" onClick={openNewSubscription}><Icon name="plus" />Add subscription</button>
                    </div>
                    {subsWithRenewal.length === 0 ? (
                        <div className="empty-state"><p>Add the services you pay for, like Netflix or Spotify, to see when each one renews.</p><button className="btn btn-primary btn-sm" onClick={openNewSubscription}><Icon name="plus" />Add your first subscription</button></div>
                    ) : (
                        <ul className="items">
                            {subsWithRenewal.map((sub) => {
                                const trialEnded = sub.isFreeTrial && sub.days !== null && sub.days < 0;
                                return (
                                    <li key={sub.id} className={`item${editingSubId === sub.id ? ' editing' : ''}`}>
                                        <span className="item-mark" style={{ background: markColor(sub.name) }} aria-hidden="true">{(sub.name || '?').charAt(0).toUpperCase()}</span>
                                        <div>
                                            <div className="item-name">{sub.name}</div>
                                            <div className="item-meta">
                                                {sub.next ? <span>{trialEnded ? 'Trial ended' : sub.isFreeTrial ? 'Trial ends' : 'Renews'} {prettyDate(sub.next)}</span> : <span>No renewal date</span>}
                                                {sub.isFreeTrial && !trialEnded && <span className="chip">Free trial</span>}
                                                {sub.days !== null && sub.days >= 0 && sub.days <= 7 && <span className="chip soon">{whenText(sub.days)}</span>}
                                                {trialEnded && <span className="chip alert">Trial ended</span>}
                                            </div>
                                        </div>
                                        <div className="item-right">
                                            <div className="item-amt num">{formatINR(sub.cost)}<small>/{sub.cycle === 'yearly' ? 'yr' : 'mo'}</small></div>
                                            <div className="item-actions">
                                                <button className="icon-btn" onClick={() => openEditSubscription(sub)} aria-label={`Edit ${sub.name}`}><Icon name="edit" /></button>
                                                <button className="icon-btn danger" onClick={() => deleteSubscription(sub)} aria-label={`Delete ${sub.name}`}><Icon name="trash" /></button>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                {/* Expenses */}
                <section className="panel span-6">
                    <div className="panel-head">
                        <h2>Expenses<span className="count">{expenses.length}</span></h2>
                        <button className="btn btn-primary btn-sm" onClick={openNewExpense}><Icon name="plus" />Add expense</button>
                    </div>
                    {expenses.length === 0 ? (
                        <div className="empty-state"><p>Log what you spend day to day, like groceries, rent or travel, to see your month-end forecast.</p><button className="btn btn-primary btn-sm" onClick={openNewExpense}><Icon name="plus" />Add your first expense</button></div>
                    ) : (
                        <>
                            <div className="filters">
                                <input className="input input-sm" type="search" placeholder="Search expenses" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search expenses" />
                                <select className="input input-sm" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} aria-label="Filter by category">
                                    <option value="All">All categories</option>
                                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <select className="input input-sm" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} aria-label="Filter by month">
                                    <option value="current">This month</option>
                                    <option value="all">All time</option>
                                </select>
                            </div>
                            <div className="list-total">{filteredExpenses.length} {filteredExpenses.length === 1 ? 'expense' : 'expenses'}, {formatINR(filteredTotal)} in total</div>
                            {filteredExpenses.length === 0 ? (
                                <p className="empty">No expenses match these filters.</p>
                            ) : (
                                <ul className="items">
                                    {filteredExpenses.map((exp) => (
                                        <li key={exp.id} className={`item${editingExpId === exp.id ? ' editing' : ''}`}>
                                            <span className="item-mark" style={{ background: CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.Other }} aria-hidden="true">{(exp.category || 'O').charAt(0)}</span>
                                            <div>
                                                <div className="item-name">{exp.name}</div>
                                                <div className="item-meta"><span>{exp.category || 'Other'}{exp.date ? `, ${prettyDate(parseLocalDate(exp.date))}` : ''}</span></div>
                                            </div>
                                            <div className="item-right">
                                                <div className="item-amt num">{formatINR(exp.amount)}</div>
                                                <div className="item-actions">
                                                    <button className="icon-btn" onClick={() => openEditExpense(exp)} aria-label={`Edit ${exp.name}`}><Icon name="edit" /></button>
                                                    <button className="icon-btn danger" onClick={() => deleteExpense(exp)} aria-label={`Delete ${exp.name}`}><Icon name="trash" /></button>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </section>

                {/* Category limits */}
                <section className="panel span-12">
                    <div className="panel-head">
                        <h2>Category budgets</h2>
                        <button className="btn btn-sm" onClick={() => setEditingLimits(!editingLimits)}>{editingLimits ? 'Done' : 'Set limits'}</button>
                        {editingLimits && <p className="fine" style={{ width: '100%' }}>Type a limit and press Enter, or click outside the box, to save it. Leave it empty for no limit.</p>}
                    </div>
                    <div className="limits">
                        {CATEGORIES.map((c) => {
                            const limit = Number(categoryBudgets[c] || 0);
                            const spent = spentByCategory[c] || 0;
                            const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
                            const over = limit > 0 && spent > limit;
                            return (
                                <div key={c}>
                                    <div className="limit-top">
                                        <strong>{c}</strong>
                                        <span className={`amt num${over ? ' over' : ''}`}>{formatINR(spent)}{limit > 0 ? ` of ${formatINR(limit)}` : ''}</span>
                                    </div>
                                    <div className="bar"><span style={{ width: `${pct}%`, background: over ? '#c23b2e' : pct > 80 ? '#e9a21b' : CATEGORY_COLORS[c] }} /></div>
                                    {over && <div className="limit-note">{formatINR(spent - limit)} over this limit</div>}
                                    {editingLimits && (
                                        <input className="input input-sm limit-input" type="number" min="0" step="1" inputMode="numeric" placeholder="No limit" aria-label={`${c} monthly limit in rupees`}
                                            value={c in limitDrafts ? limitDrafts[c] : (categoryBudgets[c] ?? '')}
                                            onChange={(e) => setLimitDrafts((prev) => ({ ...prev, [c]: e.target.value }))}
                                            onBlur={() => commitCategoryLimit(c)}
                                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>

            {/* Subscription form */}
            {modal === 'sub' && (
                <Modal title={editingSubId ? 'Edit subscription' : 'Add a subscription'} onClose={closeModal}>
                    <form onSubmit={handleSubscriptionSubmit} style={{ display: 'grid', gap: '14px' }}>
                        {!editingSubId && (
                            <div className="quick-picks" aria-label="Popular services">
                                {QUICK_PICKS.map((n) => <button type="button" key={n} onClick={() => setSubName(n)}>{n}</button>)}
                            </div>
                        )}
                        <div className="field">
                            <label htmlFor="sub-name">Name</label>
                            <input id="sub-name" className="input" autoFocus placeholder="Netflix" value={subName} onChange={(e) => setSubName(e.target.value)} />
                        </div>
                        <div className="row-2">
                            <div className="field">
                                <label htmlFor="sub-cost">Price (₹)</label>
                                <input id="sub-cost" className="input" type="number" min="0" inputMode="decimal" placeholder="649" value={subCost} onChange={(e) => setSubCost(e.target.value)} />
                            </div>
                            <div className="field">
                                <label htmlFor="sub-cycle">Billed</label>
                                <select id="sub-cycle" className="input" value={subCycle} onChange={(e) => setSubCycle(e.target.value)}>
                                    <option value="monthly">Every month</option>
                                    <option value="yearly">Every year</option>
                                </select>
                            </div>
                        </div>
                        <label className="check"><input type="checkbox" checked={subIsFreeTrial} onChange={(e) => setSubIsFreeTrial(e.target.checked)} />I'm on a free trial</label>
                        <div className="field">
                            <label htmlFor="sub-date">{subIsFreeTrial ? 'Trial ends on' : 'Next renewal'}</label>
                            <input id="sub-date" className="input" type="date" value={subRenewalDate} onChange={(e) => setSubRenewalDate(e.target.value)} />
                        </div>
                        {formError && <p className="form-error" role="alert">{formError}</p>}
                        <div className="modal-actions">
                            <button type="button" className="btn" onClick={closeModal}>Cancel</button>
                            <button type="submit" className="btn btn-primary">{editingSubId ? 'Save changes' : 'Add subscription'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Expense form */}
            {modal === 'exp' && (
                <Modal title={editingExpId ? 'Edit expense' : 'Add an expense'} onClose={closeModal}>
                    <form onSubmit={handleExpenseSubmit} style={{ display: 'grid', gap: '14px' }}>
                        <div className="field">
                            <label htmlFor="exp-name">What did you spend on?</label>
                            <input id="exp-name" className="input" autoFocus placeholder="Groceries" value={expName} onChange={(e) => setExpName(e.target.value)} />
                        </div>
                        <div className="row-2">
                            <div className="field">
                                <label htmlFor="exp-amount">Amount (₹)</label>
                                <input id="exp-amount" className="input" type="number" min="0" inputMode="decimal" placeholder="450" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
                            </div>
                            <div className="field">
                                <label htmlFor="exp-date">Date</label>
                                <input id="exp-date" className="input" type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
                            </div>
                        </div>
                        <div className="field">
                            <label>Category</label>
                            <div className="quick-picks" role="radiogroup" aria-label="Category">
                                {CATEGORIES.map((c) => (
                                    <button type="button" key={c} role="radio" aria-checked={expCategory === c} onClick={() => setExpCategory(c)}
                                        style={expCategory === c ? { background: CATEGORY_COLORS[c], borderColor: CATEGORY_COLORS[c], color: '#fff' } : undefined}>
                                        {c}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {formError && <p className="form-error" role="alert">{formError}</p>}
                        <div className="modal-actions">
                            <button type="button" className="btn" onClick={closeModal}>Cancel</button>
                            <button type="submit" className="btn btn-primary">{editingExpId ? 'Save changes' : 'Add expense'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Toast */}
            {toast && (
                <div className={`toast${toast.error ? ' error' : ''}`} role={toast.error ? 'alert' : 'status'}>
                    <span>{toast.message}</span>
                    {toast.undo && (
                        <button onClick={async () => {
                            try {
                                await toast.undo();
                                setToast({ message: 'Restored' });
                            } catch (error) {
                                showWriteError('restore it', error);
                            }
                        }}>Undo</button>
                    )}
                </div>
            )}
        </div>
    );
}

export default App;
