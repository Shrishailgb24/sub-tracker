import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { ref, onValue, push, set } from "firebase/database";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { db, auth, provider } from "./firebase";

// Helper functions
const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

const isRenewingSoon = (dateString) => {
    if (!dateString) return false;
    const renewalDate = new Date(dateString);
    const today = new Date();
    const diffDays = Math.ceil((renewalDate - today) / (1000 * 60 * 60 * 24));
    return diffDays <= 7 && diffDays >= 0;
};

const pieColors = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#A28DFF', '#FF6666'];

function App() {
    // --- USER AUTHENTICATION STATE ---
    const [user, setUser] = useState(null);

    // --- APP STATE ---
    const [subscriptions, setSubscriptions] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [newName, setNewName] = useState('');
    const [newCost, setNewCost] = useState('');
    const [newRenewalDate, setNewRenewalDate] = useState('');
    const [isFreeTrial, setIsFreeTrial] = useState(false);
    const [expenseName, setExpenseName] = useState('');
    const [expenseAmount, setExpenseAmount] = useState('');
    const [expenseCategory, setExpenseCategory] = useState('Food');
    const [monthlyBudget, setMonthlyBudget] = useState(20000);

    // --- CHECK LOGIN STATUS ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });
        return () => unsubscribe();
    }, []);

    // --- FIREBASE LIVE SYNC (USER SPECIFIC) ---
    useEffect(() => {
        // If nobody is logged in, clear the screen and stop trying to fetch data
        if (!user) {
            setSubscriptions([]);
            setExpenses([]);
            return;
        }

        // 1. Listen to THIS specific user's subscriptions
        const subsRef = ref(db, `users/${user.uid}/subscriptions`);
        const unsubSubs = onValue(subsRef, (snapshot) => {
            const data = snapshot.val();
            const cloudSubs = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
            setSubscriptions(cloudSubs);
        });

        // 2. Listen to THIS specific user's expenses
        const expsRef = ref(db, `users/${user.uid}/expenses`);
        const unsubExps = onValue(expsRef, (snapshot) => {
            const data = snapshot.val();
            const cloudExps = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
            setExpenses(cloudExps);
        });

        return () => {
            unsubSubs();
            unsubExps();
        };
    }, [user]); // Re-run this if the user logs in or out

    // --- CALCULATIONS ---
    const totalMonthlySubscriptions = subscriptions.reduce((total, sub) => sub.isFreeTrial ? total : total + Number(sub.cost || 0), 0);
    const totalGeneralExpenses = expenses.reduce((total, exp) => total + Number(exp.amount || 0), 0);
    const currentDay = new Date().getDate();
    const combinedCurrentTotal = totalMonthlySubscriptions + totalGeneralExpenses;
    const projectedSpend = (combinedCurrentTotal / currentDay) * 30;

    const expenseCategoryData = expenses.reduce((acc, expense) => {
        const category = expense.category || 'Other';
        const amount = Number(expense.amount || 0);
        const existing = acc.find((item) => item.name === category);
        if (existing) existing.value += amount;
        else acc.push({ name: category, value: amount });
        return acc;
    }, []).filter((item) => item.value > 0);

    // --- AUTHENTICATION ACTIONS ---
    const handleLogin = async () => {
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Login Error:", error);
            window.alert("Failed to log in. Please try again.");
        }
    };

    const handleLogout = () => {
        signOut(auth);
    };

    // --- DATABASE ADD FUNCTIONS (USER SPECIFIC) ---
    const handleSubscriptionSubmit = async (e) => {
        e.preventDefault();
        if (!newName.trim() || !newCost) return window.alert('Please fill out the name and cost!');

        const newSubscription = { name: newName, cost: Number(newCost), nextRenewalDate: newRenewalDate, isFreeTrial, usageCount: 1 };
        try {
            // Push to the user's private folder!
            await set(push(ref(db, `users/${user.uid}/subscriptions`)), newSubscription);
            setNewName(''); setNewCost(''); setNewRenewalDate(''); setIsFreeTrial(false);
        } catch (error) {
            console.error("Error adding:", error);
        }
    };

    const handleExpenseSubmit = async (e) => {
        e.preventDefault();
        if (!expenseName.trim() || !expenseAmount || Number(expenseAmount) <= 0) return window.alert('Please fill out all required fields!');

        const newExpense = { name: expenseName, amount: Number(expenseAmount), category: expenseCategory };
        try {
             // Push to the user's private folder!
            await set(push(ref(db, `users/${user.uid}/expenses`)), newExpense);
            setExpenseName(''); setExpenseAmount(''); setExpenseCategory('Food');
        } catch (error) {
            console.error("Error adding:", error);
        }
    };

    // --- UI RENDER: LOGIN SCREEN ---
    if (!user) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Arial, sans-serif', backgroundColor: '#f4f6f8' }}>
                <div style={{ padding: '40px', background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', textAlign: 'center' }}>
                    <h1 style={{ marginTop: 0 }}>Financial Tracker</h1>
                    <p style={{ color: '#555', marginBottom: '24px' }}>Please sign in to access your private vault.</p>
                    <button 
                        onClick={handleLogin} 
                        style={{ padding: '12px 24px', fontSize: '16px', background: '#4285F4', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        Sign in with Google
                    </button>
                </div>
            </div>
        );
    }

    // --- UI RENDER: MAIN DASHBOARD ---
    return (
        <div style={{ padding: '24px', fontFamily: 'Arial, sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
            
            {/* Header with User Info and Logout */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '2px solid #eee', paddingBottom: '16px' }}>
                <h1 style={{ margin: 0 }}>Dashboard</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ color: '#666' }}>Logged in as: <strong>{user.email}</strong></span>
                    <button onClick={handleLogout} style={{ padding: '8px 16px', background: '#fce4e4', color: '#cc0000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                        Log Out
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white' }}>
                    <h2>Summary</h2>
                    <div style={{ display: 'grid', gap: '12px', marginBottom: '12px' }}>
                        <label>
                            Monthly Budget
                            <input type="number" value={monthlyBudget} onChange={(e) => setMonthlyBudget(Number(e.target.value))} style={{ display: 'block', marginTop: '6px', padding: '8px', width: '100%', boxSizing: 'border-box' }} />
                        </label>
                    </div>
                    <p>Total Monthly Subscription Cost: <strong>{currencyFormatter.format(totalMonthlySubscriptions)}</strong></p>
                    <p>Total General Expenses Cost: <strong>{currencyFormatter.format(totalGeneralExpenses)}</strong></p>
                    <p>Projected End-of-Month Spend: <strong>{currencyFormatter.format(projectedSpend)}</strong></p>
                    {projectedSpend > monthlyBudget && (
                        <div style={{ marginTop: '12px', padding: '12px', border: '2px solid #b00020', background: '#ffe8ec', color: '#7a0015', borderRadius: '8px', fontWeight: 700 }}>
                            Early Warning: Projected to exceed budget by {currencyFormatter.format(projectedSpend - monthlyBudget)}
                        </div>
                    )}
                    {expenseCategoryData.length > 0 ? (
                        <PieChart width={400} height={300}>
                            <Pie data={expenseCategoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                                {expenseCategoryData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value) => currencyFormatter.format(value)} />
                            <Legend />
                        </PieChart>
                    ) : (
                        <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>Add expenses to see chart</div>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
                <section style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white' }}>
                    <h2>Subscriptions</h2>
                    <form onSubmit={handleSubscriptionSubmit} style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
                        <input type="text" placeholder="Subscription name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ padding: '8px' }}/>
                        <input type="number" placeholder="Cost" value={newCost} onChange={(e) => setNewCost(e.target.value)} style={{ padding: '8px' }}/>
                        <input type="date" value={newRenewalDate} onChange={(e) => setNewRenewalDate(e.target.value)} style={{ padding: '8px' }}/>
                        <label><input type="checkbox" checked={isFreeTrial} onChange={(e) => setIsFreeTrial(e.target.checked)} /> Is Free Trial</label>
                        <button type="submit" style={{ padding: '10px', background: '#333', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Add Subscription</button>
                    </form>
                    <div style={{ display: 'grid', gap: '12px' }}>
                        {subscriptions.map((sub) => (
                            <div key={sub.id} style={{ padding: '12px', border: '1px solid #eee', borderRadius: '8px' }}>
                                <div><strong>{sub.name}</strong> - {currencyFormatter.format(Number(sub.cost || 0))}</div>
                                <div>Next Renewal Date: {sub.nextRenewalDate || 'N/A'}</div>
                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                                    {sub.isFreeTrial && <span style={{ padding: '4px 8px', background: '#eef6ff', borderRadius: '999px', fontSize: '12px' }}>Free Trial</span>}
                                    {isRenewingSoon(sub.nextRenewalDate) && <span style={{ padding: '4px 8px', background: '#ffdddd', color: '#b00020', borderRadius: '999px', fontSize: '12px' }}>Renewing Soon!</span>}
                                </div>
                            </div>
                        ))}
                        {subscriptions.length === 0 && <p style={{ color: '#999', textAlign: 'center' }}>No subscriptions yet.</p>}
                    </div>
                </section>

                <section style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white' }}>
                    <h2>Expenses</h2>
                    <form onSubmit={handleExpenseSubmit} style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
                        <input type="text" placeholder="Expense Name" value={expenseName} onChange={(e) => setExpenseName(e.target.value)} style={{ padding: '8px' }}/>
                        <input type="number" placeholder="Amount" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} style={{ padding: '8px' }}/>
                        <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} style={{ padding: '8px' }}>
                            <option value="Food">Food</option>
                            <option value="Rent">Rent</option>
                            <option value="Transport">Transport</option>
                            <option value="Entertainment">Entertainment</option>
                            <option value="Utilities">Utilities</option>
                        </select>
                        <button type="submit" style={{ padding: '10px', background: '#333', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Add Expense</button>
                    </form>
                    <div style={{ display: 'grid', gap: '12px' }}>
                        {expenses.map((expense) => (
                            <div key={expense.id} style={{ padding: '12px', border: '1px solid #eee', borderRadius: '8px' }}>
                                <div><strong>{expense.name}</strong> - {currencyFormatter.format(Number(expense.amount || 0))}</div>
                                <div>Category: {expense.category}</div>
                            </div>
                        ))}
                        {expenses.length === 0 && <p style={{ color: '#999', textAlign: 'center' }}>No expenses yet.</p>}
                    </div>
                </section>
            </div>
        </div>
    );
}

export default App;