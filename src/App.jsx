import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

function App() {
	const [subscriptions, setSubscriptions] = useState(() => {
		const saved = localStorage.getItem('subs');
		return saved ? JSON.parse(saved) : [];
	});
	const [expenses, setExpenses] = useState(() => {
		const saved = localStorage.getItem('exps');
		return saved ? JSON.parse(saved) : [];
	});
	const [newName, setNewName] = useState('');
	const [newCost, setNewCost] = useState('');
	const [newRenewalDate, setNewRenewalDate] = useState('');
	const [isFreeTrial, setIsFreeTrial] = useState(false);
	const [expenseName, setExpenseName] = useState('');
	const [expenseAmount, setExpenseAmount] = useState('');
	const [expenseCategory, setExpenseCategory] = useState('Food');
	const [monthlyBudget, setMonthlyBudget] = useState(20000);

	useEffect(() => {
		localStorage.setItem('subs', JSON.stringify(subscriptions));
	}, [subscriptions]);

	useEffect(() => {
		localStorage.setItem('exps', JSON.stringify(expenses));
	}, [expenses]);

	const totalMonthlySubscriptions = subscriptions.reduce((total, subscription) => {
		if (subscription.isFreeTrial) {
			return total;
		}
		return total + Number(subscription.cost || 0);
	}, 0);

	const totalGeneralExpenses = expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
	const currentDay = new Date().getDate();
	const combinedCurrentTotal = totalMonthlySubscriptions + totalGeneralExpenses;
	const projectedSpend = (combinedCurrentTotal / currentDay) * 30;

	const expenseCategoryData = expenses
		.reduce((acc, expense) => {
			const category = expense.category || 'Other';
			const amount = Number(expense.amount || 0);
			const existing = acc.find((item) => item.name === category);
			if (existing) {
				existing.value += amount;
			} else {
				acc.push({ name: category, value: amount });
			}
			return acc;
		}, [])
		.filter((item) => item.value > 0);

	const pieColors = ['#1D4ED8', '#059669', '#D97706', '#7C3AED', '#DC2626'];

	const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

	function isRenewingSoon(renewalDate) {
		if (!renewalDate) return false;
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const renewal = new Date(renewalDate);
		renewal.setHours(0, 0, 0, 0);
		const diffDays = (renewal.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
		return diffDays >= 0 && diffDays <= 7;
	}

	function handleSubmit(e) {
		e.preventDefault();

		if (!newName.trim() || !newCost || Number(newCost) <= 0) {
			window.alert('Please fill out all required fields!');
			return;
		}

		const newSubscription = {
			id: Date.now(),
			name: newName,
			cost: Number(newCost),
			nextRenewalDate: newRenewalDate,
			isFreeTrial,
			usageCount: 1,
		};

		setSubscriptions([...subscriptions, newSubscription]);
		setNewName('');
		setNewCost('');
		setNewRenewalDate('');
		setIsFreeTrial(false);
	}

	function handleExpenseSubmit(e) {
		e.preventDefault();

		if (!expenseName.trim() || !expenseAmount || Number(expenseAmount) <= 0) {
			window.alert('Please fill out all required fields!');
			return;
		}

		const newExpense = {
			id: Date.now(),
			name: expenseName,
			amount: Number(expenseAmount),
			category: expenseCategory,
		};

		setExpenses([...expenses, newExpense]);
		setExpenseName('');
		setExpenseAmount('');
		setExpenseCategory('Food');
	}

	function incrementUsageCount(subscriptionId) {
		setSubscriptions(
			subscriptions.map((subscription) =>
				subscription.id === subscriptionId
					? { ...subscription, usageCount: subscription.usageCount + 1 }
					: subscription
			)
		);
	}

	return (
		<div style={{ padding: '24px', fontFamily: 'Arial, sans-serif' }}>
			<h1>Personal Finance & Subscription Tracker</h1>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
					gap: '16px',
					marginBottom: '24px',
				}}
			>
				<div style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px' }}>
					<h2>Dashboard Summary</h2>
					<div style={{ display: 'grid', gap: '12px', marginBottom: '12px' }}>
						<label>
							Monthly Budget
							<input
								type="number"
								value={monthlyBudget}
								onChange={(e) => setMonthlyBudget(Number(e.target.value))}
								style={{ display: 'block', marginTop: '6px' }}
							/>
						</label>
					</div>
					<p>Total Monthly Subscription Cost: {currencyFormatter.format(totalMonthlySubscriptions)}</p>
					<p>Total General Expenses Cost: {currencyFormatter.format(totalGeneralExpenses)}</p>
					<p>Projected End-of-Month Spend: {currencyFormatter.format(projectedSpend)}</p>
					{projectedSpend > monthlyBudget && (
						<div style={{ marginTop: '12px', padding: '12px', border: '2px solid #b00020', background: '#ffe8ec', color: '#7a0015', borderRadius: '8px', fontWeight: 700 }}>
							Early Warning: At your current daily spending velocity, you are projected to exceed your monthly budget by {currencyFormatter.format(projectedSpend - monthlyBudget)}
						</div>
					)}
					<PieChart width={400} height={300}>
						<Pie data={expenseCategoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
							{expenseCategoryData.map((entry, index) => (
								<Cell key={`cell-${entry.name}-${index}`} fill={pieColors[index % pieColors.length]} />
							))}
						</Pie>
						<Tooltip />
						<Legend />
					</PieChart>
				</div>
			</div>
			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
				<section style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px' }}>
					<h2>Subscriptions</h2>
					<form onSubmit={handleSubmit} style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
						<input type="text" placeholder="Subscription name" value={newName} onChange={(e) => setNewName(e.target.value)} />
						<input type="number" placeholder="Cost" value={newCost} onChange={(e) => setNewCost(e.target.value)} />
						<input type="date" value={newRenewalDate} onChange={(e) => setNewRenewalDate(e.target.value)} />
						<label>
							<input type="checkbox" checked={isFreeTrial} onChange={(e) => setIsFreeTrial(e.target.checked)} /> Is Free Trial
						</label>
						<button type="submit">Add Subscription</button>
					</form>
					<div style={{ display: 'grid', gap: '12px' }}>
						{subscriptions.map((subscription) => (
							<div key={subscription.id} style={{ padding: '12px', border: '1px solid #eee', borderRadius: '8px' }}>
								<div>
									<strong>{subscription.name}</strong> - {currencyFormatter.format(Number(subscription.cost || 0))}
								</div>
								<div>Next Renewal Date: {subscription.nextRenewalDate || 'N/A'}</div>
								<div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
									{subscription.isFreeTrial && <span style={{ padding: '4px 8px', background: '#eef6ff', borderRadius: '999px' }}>Free Trial</span>}
									{isRenewingSoon(subscription.nextRenewalDate) && (
										<span style={{ padding: '4px 8px', background: '#ffdddd', color: '#b00020', borderRadius: '999px' }}>Renewing Soon!</span>
									)}
								</div>
							</div>
						))}
					</div>
				</section>

				<section style={{ padding: '16px', border: '1px solid #ddd', borderRadius: '8px' }}>
					<h2>Expenses</h2>
					<form onSubmit={handleExpenseSubmit} style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
						<input type="text" placeholder="Expense Name" value={expenseName} onChange={(e) => setExpenseName(e.target.value)} />
						<input type="number" placeholder="Amount" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} />
						<select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)}>
							<option value="Food">Food</option>
							<option value="Rent">Rent</option>
							<option value="Transport">Transport</option>
							<option value="Entertainment">Entertainment</option>
							<option value="Utilities">Utilities</option>
						</select>
						<button type="submit">Add Expense</button>
					</form>
					<div style={{ display: 'grid', gap: '12px' }}>
						{expenses.map((expense) => (
							<div key={expense.id} style={{ padding: '12px', border: '1px solid #eee', borderRadius: '8px' }}>
								<div>
									<strong>{expense.name}</strong> - {currencyFormatter.format(Number(expense.amount || 0))}
								</div>
								<div>Category: {expense.category}</div>
							</div>
						))}
					</div>
				</section>
			</div>
		</div>
	);
}

export default App;
