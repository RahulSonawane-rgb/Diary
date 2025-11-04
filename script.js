const STORAGE_KEY = 'moneyManagerLedgerData';
let appData = {};
let totalOwedChart = null; // Variable to hold the total owed chart instance
let investedFundsChart = null; // Variable to hold the invested funds chart instance
let loansGivenChart = null;

// --- UTILITY FUNCTIONS ---

/**
 * Generates a unique ID (simple timestamp-based for this vanilla app).
 * @returns {string} Unique ID.
 */
function generateId() {
    return Date.now().toString();
}

/**
 * Formats a number into Rupee currency string.
 * @param {number} amount
 * @returns {string} Formatted Rupee string.
 */
function formatCurrency(amount) {
    if (typeof amount !== 'number') amount = 0;
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

/**
 * Gets the current date in YYYY-MM-DD format.
 * @returns {string}
 */
function getCurrentDate() {
    return new Date().toISOString().split('T')[0];
}


// --- DATA MANAGEMENT AND PERSISTENCE ---

/**
 * Initializes or loads data from localStorage.
 */
function loadData() {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (storedData) {
        try {
            appData = JSON.parse(storedData);
        } catch (e) {
            console.error("Failed to parse stored data:", e);
            initializeData();
        }
    } else {
        initializeData();
    }
    // Ensure the required top-level arrays exist
    appData.people = appData.people || [];
    appData.accounts = appData.accounts || [];
    appData.investments = appData.investments || [];
    appData.loans = appData.loans || [];

    // Ensure at least one default account exists
    if (appData.accounts.length === 0) {
        appData.accounts.push({
            id: generateId(),
            name: "Default Bank Account",
            balance: 0,
            transactions: [],
            type: "Bank"
        });
    }
}

/**
 * Sets up the initial empty data structure.
 */
function initializeData() {
    appData = {
        people: [],
        accounts: [{
            id: generateId(),
            name: "Default Bank Account",
            balance: 0,
            transactions: [],
            type: "Bank"
        }],
        investments: [],
        loans: []
    };
    saveData();
}

/**
 * Saves current appData to localStorage.
 */
function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}


// --- CALCULATION LOGIC ---

/**
 * Recalculates the net owed amount for a specific person.
 * @param {string} personId
 */
function recalculatePersonNetOwed(personId) {
    const person = appData.people.find(p => p.id === personId);
    if (!person) return;

    const totalReceived = person.received.reduce((sum, t) => sum + t.amount, 0);
    const totalReturned = person.returned.reduce((sum, t) => sum + t.amount, 0);
    const totalInvested = person.invested.reduce((sum, t) => sum + t.amount, 0);

    person.netOwed = totalReceived - totalReturned - totalInvested;
}

/**
 * Recalculates the net owed to me for a specific loan borrower.
 * @param {string} loanId
 */
function recalculateLoanNetOwed(loanId) {
    const loan = appData.loans.find(l => l.id === loanId);
    if (!loan) return;

    const totalGiven = loan.given.reduce((sum, t) => sum + t.amount, 0);
    const totalRecovered = loan.recovered.reduce((sum, t) => sum + t.amount, 0);

    loan.netOwedToMe = totalGiven - totalRecovered;
}

/**
 * Calculates the total liquid obligations.
 * @returns {number} Sum of all positive Net Owed amounts across all people.
 */
function calculateTotalLiquidObligations() {
    return appData.people.reduce((sum, person) => {
        // A person's liquid obligation is their netOwed, but only if it's positive
        // and we assume the netOwed calculation already accounts for what's invested.
        return sum + Math.max(0, person.netOwed);
    }, 0);
}

/**
 * Calculates the total invested amount across all investments.
 * @returns {number}
 */
function calculateTotalInvested() {
    return appData.investments.reduce((sum, inv) => sum + inv.totalAmount, 0);
}

/**
 * Updates the global metrics shown in the dashboard footer.
 */
function updateGlobalMetrics() {
    // 1. Recalculate all net owed
    appData.people.forEach(p => recalculatePersonNetOwed(p.id));

    // 2. Get totals
    const bankBalance = appData.accounts[0] ? appData.accounts[0].balance : 0;
    const liquidObligations = calculateTotalLiquidObligations();
    const totalInvested = calculateTotalInvested();
    const totalReceivables = appData.loans.reduce((sum, l) => sum + Math.max(0, l.netOwedToMe), 0);
    const totalOwed = appData.people.reduce((sum, p) => sum + Math.max(0, p.netOwed + p.invested.reduce((s,i) => s + i.amount, 0)), 0);

    // 3. Update DOM
    document.getElementById('footer-bank-balance').textContent = formatCurrency(bankBalance);
    document.getElementById('footer-liquid-obligations').textContent = formatCurrency(liquidObligations);
    document.getElementById('footer-total-invested').textContent = formatCurrency(totalInvested);
    document.getElementById('footer-total-receivables').textContent = formatCurrency(totalReceivables);

    // 4. Liquidity Alert
    const alertElement = document.getElementById('liquidity-alert');
    if (bankBalance < liquidObligations) {
        alertElement.style.display = 'block';
        alertElement.innerHTML = `⚠️ **Liquidity Alert:** Bank balance (${formatCurrency(bankBalance)}) is less than liquid obligations (${formatCurrency(liquidObligations)})!`;
    } else {
        alertElement.style.display = 'none';
    }

    // The main renderApp function calls this function. Calling renderApp from here would
    // create an infinite loop. The charts are correctly redrawn whenever renderApp is called,
    // so no additional action is needed here to update them.
}


// --- TRANSACTION HANDLERS ---

/**
 * Handles adding a simple transaction (Receipt/Return/Investment).
 * @param {Event} event
 */
function handleTransaction(event) {
    event.preventDefault();

    const type = document.querySelector('input[name="transaction-type"]:checked').value;
    const personId = document.getElementById('trans-person').value;
    const amount = parseFloat(document.getElementById('trans-amount').value);
    const date = document.getElementById('trans-date').value || getCurrentDate();
    const notes = document.getElementById('trans-notes').value;
    const bankAccount = appData.accounts[0]; // Use the default account

    if (!personId || amount <= 0) {
        alert("Please select a person and enter a valid amount.");
        return;
    }
    
    const person = appData.people.find(p => p.id === personId);
    let investmentId = null;

    const transactionId = generateId(); // Generate a single ID for this entire operation
    try {
        if (type === 'Receipt') {
            person.received.push({ amount, date, notes, id: transactionId });
            bankAccount.balance += amount;
            bankAccount.transactions.push({ id: transactionId, type, amount, date, description: `${person.name} gave funds.`, linkedPersonId: personId });

        } else if (type === 'Return') {
            if (amount > person.netOwed) {
                // Should use the simulation logic, but for simple return, we prevent over-return
                alert(`Cannot return ₹${amount}. Liquid owed to ${person.name} is only ${formatCurrency(person.netOwed)}.`);
                return;
            }
            if (amount > bankAccount.balance) {
                alert(`Cannot return ₹${amount}. Bank balance is only ${formatCurrency(bankAccount.balance)}.`);
                return;
            }

            person.returned.push({ amount, date, notes, id: transactionId });
            bankAccount.balance -= amount;
            bankAccount.transactions.push({ id: transactionId, type, amount: -amount, date, description: `Returned funds to ${person.name}.`, linkedPersonId: personId });

        } else if (type === 'Investment') {
            const investmentName = document.getElementById('invest-name').value;
            if (!investmentName) {
                alert("Investment name is required.");
                return;
            }
            if (amount > person.netOwed) {
                alert(`Cannot invest ₹${amount} of ${person.name}'s money. Liquid available is only ${formatCurrency(person.netOwed)}.`);
                return;
            }
            if (amount > bankAccount.balance) {
                alert(`Cannot invest ₹${amount}. Bank balance is only ${formatCurrency(bankAccount.balance)}.`);
                return;
            }

            // Create a new single-contributor investment
            investmentId = generateId();
            appData.investments.push({
                id: investmentId,
                name: investmentName,
                totalAmount: amount,
                date: date,
                contributors: [{ personId: person.id, amount: amount }],
                transactions: [{ type: 'Initial', amount, date, contributorId: person.id }],
                status: "Active",
                notes: notes
            });

            // Log investment to person and account
            person.invested.push({ amount, investmentId, date, id: transactionId });
            bankAccount.balance -= amount;
            bankAccount.transactions.push({ id: transactionId, type, amount: -amount, date, description: `Investment: ${investmentName} (using ${person.name}'s funds).`, investmentId: investmentId });
        }

        // Finalize transaction
        recalculatePersonNetOwed(personId);
        saveData();
        hideModal('transaction-modal');
        document.getElementById('transaction-form').reset();
        renderApp(document.querySelector('nav button.active').id.replace('nav-', ''));
        alert(`${type} of ${formatCurrency(amount)} successfully recorded!`);

    } catch (error) {
        console.error("Transaction failed:", error);
        alert(`An error occurred: ${error.message}`);
    }
}

// --- ADVANCED INVESTMENT HANDLERS (Multi-contributor / Add More Funds) ---

/**
 * Renders the Investment Modal for creation or editing.
 * @param {string} mode 'create' or 'edit'
 * @param {string} [investmentId] ID for editing
 */
function showInvestmentModal(mode, investmentId = null) {
    const modal = document.getElementById('investment-modal');
    document.getElementById('adv-total-amount').value = '';
    document.getElementById('adv-invest-name').value = '';
    document.getElementById('adv-invest-date').value = getCurrentDate();
    document.getElementById('invest-id').value = '';
    document.getElementById('contributors-list').innerHTML = '';
    document.getElementById('allocation-alert').style.display = 'none';

    if (mode === 'create') {
        document.getElementById('investment-modal-title').textContent = 'New Multi-Contributor Investment';
        document.getElementById('adv-invest-submit-btn').textContent = 'Create Investment';
        addContributorRow(); // Start with one row
    } else if (mode === 'edit' && investmentId) {
        const investment = appData.investments.find(i => i.id === investmentId);
        if (!investment) return alert("Investment not found.");

        document.getElementById('investment-modal-title').textContent = `Edit Investment: ${investment.name}`;
        document.getElementById('adv-invest-submit-btn').textContent = 'Update Investment';
        document.getElementById('invest-id').value = investmentId;
        document.getElementById('adv-invest-name').value = investment.name;
        document.getElementById('adv-total-amount').value = investment.totalAmount;
        document.getElementById('adv-invest-date').value = investment.date;

        // Re-create contributor rows for editing
        investment.contributors.forEach(c => {
            addContributorRow(c.personId, c.amount);
        });
    }

    updateAllocationSummary();
    showModal('investment-modal');
}


/**
 * Adds a row for a contributor in the advanced investment form.
 * @param {string} [personId=''] Pre-selected person ID.
 * @param {number} [amount=0] Pre-set amount.
 */
function addContributorRow(personId = '', amount = 0) {
    const list = document.getElementById('contributors-list');
    const newRow = document.createElement('div');
    newRow.classList.add('contributor-row');
    newRow.style.cssText = 'display: flex; gap: 10px; margin-bottom: 5px; align-items: center;';

    const personSelect = document.createElement('select');
    personSelect.classList.add('contributor-person');
    personSelect.required = true;
    personSelect.innerHTML = '<option value="">-- Select Person --</option>' + appData.people.map(p => 
        `<option value="${p.id}" ${p.id === personId ? 'selected' : ''}>${p.name} (Liquid: ${formatCurrency(p.netOwed)})</option>`
    ).join('');
    
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.step = 'any';
    amountInput.classList.add('contributor-amount');
    amountInput.value = amount || '';
    amountInput.placeholder = 'Amount (₹)';
    amountInput.required = true;
    amountInput.onchange = updateAllocationSummary;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '❌';
    removeBtn.onclick = () => { newRow.remove(); updateAllocationSummary(); };
    removeBtn.style.cssText = 'padding: 5px;';

    newRow.appendChild(personSelect);
    newRow.appendChild(amountInput);
    newRow.appendChild(removeBtn);
    list.appendChild(newRow);
}

/**
 * Updates the summary of allocated vs required funds in the investment modal.
 */
function updateAllocationSummary() {
    const totalRequired = parseFloat(document.getElementById('adv-total-amount').value) || 0;
    let totalAllocated = 0;
    let isValid = true;

    const contributorRows = document.querySelectorAll('.contributor-row');
    contributorRows.forEach(row => {
        const amountInput = row.querySelector('.contributor-amount');
        const personSelect = row.querySelector('.contributor-person');
        const amount = parseFloat(amountInput.value) || 0;
        const personId = personSelect.value;
        const person = appData.people.find(p => p.id === personId);

        totalAllocated += amount;

        // Check if allocation exceeds person's liquid owed (only for creation)
        if (person && amount > person.netOwed) {
            // Note: This check is complex for editing, so we simplify for create and rely on final validation.
        }
    });

    document.getElementById('required-amount').textContent = formatCurrency(totalRequired);
    document.getElementById('allocated-amount').textContent = formatCurrency(totalAllocated);

    const alertElement = document.getElementById('allocation-alert');
    if (totalAllocated !== totalRequired) {
        alertElement.style.display = 'block';
        alertElement.textContent = `Allocation Mismatch: Allocated amount (${formatCurrency(totalAllocated)}) must equal Total Investment Amount (${formatCurrency(totalRequired)}).`;
        isValid = false;
    } else {
        alertElement.style.display = 'none';
    }

    document.getElementById('adv-invest-submit-btn').disabled = !isValid;
}


/**
 * Handles the creation or update of a multi-contributor investment.
 * @param {Event} event
 */
function handleAdvancedInvestment(event) {
    event.preventDefault();

    const id = document.getElementById('invest-id').value;
    const name = document.getElementById('adv-invest-name').value;
    const totalAmount = parseFloat(document.getElementById('adv-total-amount').value);
    const date = document.getElementById('adv-invest-date').value;
    const bankAccount = appData.accounts[0];

    const newContributors = [];
    let totalAllocated = 0;
    const contributorRows = document.querySelectorAll('.contributor-row');

    contributorRows.forEach(row => {
        const personId = row.querySelector('.contributor-person').value;
        const amount = parseFloat(row.querySelector('.contributor-amount').value) || 0;
        if (personId && amount > 0) {
            newContributors.push({ personId, amount });
            totalAllocated += amount;
        }
    });

    if (totalAllocated !== totalAmount) {
        return alert("Allocation mismatch. Total allocated must equal total investment amount.");
    }
    
    const existing = appData.investments.find(i => i.name === name && i.id !== (id || ''));
    if (existing) {
        alert("An investment with this name already exists. Please choose a unique name.");
        return;
    }

    // Check if total amount is available in the bank
    if (totalAmount > bankAccount.balance) {
        return alert(`Cannot make investment. Bank balance is only ${formatCurrency(bankAccount.balance)}.`);
    }

    let investment;
    
    if (id) {
        // --- EDIT EXISTING INVESTMENT (Simplified) ---
        investment = appData.investments.find(i => i.id === id);
        if (!investment) return alert("Investment not found.");

        // NOTE: For simplicity, editing here only updates metadata (name/date) and the contributors list.
        // It does NOT re-calculate or re-log previous transactions. A real app would be complex here.
        // The totalAmount update logic should be handled by the 'Add More Funds' feature.
        // For this vanilla app, we'll only allow name/date edit.
        investment.name = name;
        investment.date = date;
        // Re-implementing contributor logic is too complex for simple vanilla JS edit, 
        // as it involves reversing old transactions and creating new ones.
        // We will restrict in-place edits to name/date and use "Add More Funds" for amount changes.
        // Alert user if they tried to change amount/contributors in edit mode.
        if (investment.totalAmount !== totalAmount || JSON.stringify(investment.contributors) !== JSON.stringify(newContributors)) {
             alert("For this application, please use 'Add More Funds' for amount changes. Only Name and Date were updated.");
        }
        
    } else {
        // --- CREATE NEW INVESTMENT ---
        
        // Final check for person liquid availability
        for (const c of newContributors) {
            const person = appData.people.find(p => p.id === c.personId);
            // Check against current person's liquid owed
            if (c.amount > person.netOwed) {
                return alert(`Cannot proceed. ${person.name}'s liquid available (${formatCurrency(person.netOwed)}) is less than their allocation (${formatCurrency(c.amount)}).`);
            }
        }

        const newId = generateId();
        investment = {
            id: newId,
            name,
            totalAmount,
            date,
            contributors: newContributors,
            transactions: [{ type: 'Initial', amount: totalAmount, date, contributorId: 'MULTI' }], // Log as multi-contributor initial transaction
            status: "Active",
            notes: ""
        };
        appData.investments.push(investment);

        // Update people and account
        bankAccount.balance -= totalAmount;
        bankAccount.transactions.push({ type: 'Investment', amount: -totalAmount, date, description: `Multi-contributor investment: ${name}.`, investmentId: newId });

        newContributors.forEach(c => {
            const person = appData.people.find(p => p.id === c.personId);
            if (person) {
                person.invested.push({ amount: c.amount, investmentId: newId, date, id: generateId() });
                recalculatePersonNetOwed(person.id);
            }
        });
    }

    saveData();
    hideModal('investment-modal');
    renderApp('investments');
    alert(`Investment "${name}" successfully ${id ? 'updated' : 'created'}!`);
}

/**
 * Shows the withdraw modal for an investment and populates it.
 * @param {string} id Investment ID.
 */
function showWithdrawModal(id) {
    const investment = appData.investments.find(i => i.id === id);
    if (!investment) return alert("Investment not found.");

    document.getElementById('withdraw-modal-title').textContent = `Withdraw from ${investment.name}`;
    document.getElementById('withdraw-invest-id').value = id;
    document.getElementById('withdraw-date').value = getCurrentDate();
    document.getElementById('withdraw-total-amount').value = ''; // Reset

    // Clear and populate contributor rows based on current contributors
    const contributorsList = document.getElementById('withdraw-contributors-list');
    contributorsList.innerHTML = '<p class="small-note">Total deallocated must equal Withdrawal Amount.</p>';
    investment.contributors.forEach(contrib => {
        const row = document.createElement('div');
        row.innerHTML = `
            <label>${appData.people.find(p => p.id === contrib.personId)?.name || 'Unknown'} (Current: ${formatCurrency(contrib.amount)}):</label>
            <input type="number" class="withdraw-contrib-amount" data-person-id="${contrib.personId}" min="0" max="${contrib.amount}" step="any" required>
        `;
        contributorsList.appendChild(row);
    });

    updateWithdrawSummary(); // Initial summary
    showModal('withdraw-modal');
}

/**
 * Updates the withdrawal allocation summary.
 */
function updateWithdrawSummary() {
    const totalWithdraw = parseFloat(document.getElementById('withdraw-total-amount').value) || 0;
    let allocated = 0;
    document.querySelectorAll('.withdraw-contrib-amount').forEach(input => {
        allocated += parseFloat(input.value) || 0;
    });

    document.getElementById('deallocated-amount').textContent = formatCurrency(allocated);
    document.getElementById('withdraw-required-amount').textContent = formatCurrency(totalWithdraw);

    const alert = document.getElementById('withdraw-allocation-alert');
    if (allocated !== totalWithdraw) {
        alert.style.display = 'block';
    } else {
        alert.style.display = 'none';
    }
}

/**
 * Auto-proportions the withdrawal across contributors based on their current share.
 */
function autoProportionWithdraw() {
    const totalWithdraw = parseFloat(document.getElementById('withdraw-total-amount').value) || 0;
    const investmentId = document.getElementById('withdraw-invest-id').value;
    const investment = appData.investments.find(i => i.id === investmentId);
    const totalCurrent = investment.totalAmount;

    if (totalWithdraw > totalCurrent) {
        alert("Withdrawal cannot exceed current total amount.");
        return;
    }

    document.querySelectorAll('.withdraw-contrib-amount').forEach(input => {
        const personId = input.dataset.personId;
        const contrib = investment.contributors.find(c => c.personId === personId);
        const proportion = contrib.amount / totalCurrent;
        input.value = Math.round(totalWithdraw * proportion); // Or use parseFloat for decimals
    });

    updateWithdrawSummary();
}

/**
 * Handles the withdrawal submission.
 * @param {Event} event
 */
function handleWithdraw(event) {
    event.preventDefault();

    const id = document.getElementById('withdraw-invest-id').value;
    const totalWithdraw = parseFloat(document.getElementById('withdraw-total-amount').value);
    const date = document.getElementById('withdraw-date').value || getCurrentDate();
    const bankAccount = appData.accounts[0];

    const investment = appData.investments.find(i => i.id === id);
    if (totalWithdraw > investment.totalAmount) {
        alert("Withdrawal exceeds current investment amount.");
        return;
    }

    let allocated = 0;
    const deallocations = [];
    document.querySelectorAll('.withdraw-contrib-amount').forEach(input => {
        const amount = parseFloat(input.value) || 0;
        allocated += amount;
        deallocations.push({ personId: input.dataset.personId, amount });
    });

    if (allocated !== totalWithdraw) {
        alert("Deallocations must match total withdrawal amount.");
        return;
    }

    const transactionId = generateId();
    try {
        // Update investment
        investment.totalAmount -= totalWithdraw;
        investment.date = date; // Optional: Update last modified

        // Adjust contributors and persons
        deallocations.forEach(dealloc => {
            const contrib = investment.contributors.find(c => c.personId === dealloc.personId);
            if (contrib) contrib.amount -= dealloc.amount;

            const person = appData.people.find(p => p.id === dealloc.personId);
            if (person) {
                const investedEntry = person.invested.find(inv => inv.investmentId === id);
                if (investedEntry) investedEntry.amount -= dealloc.amount;
                recalculatePersonNetOwed(person.id);
            }
        });

        // Credit bank (withdrawal adds back to bank)
        bankAccount.balance += totalWithdraw;
        bankAccount.transactions.push({
            id: transactionId,
            type: 'Withdrawal',
            amount: totalWithdraw,
            date,
            description: `Withdrew from ${investment.name}.`,
            investmentId: id
        });

        cleanZeroInvestments(); // Auto-remove if now zero
        saveData();
        updateGlobalMetrics();
        hideModal('withdraw-modal');
        renderApp('investments');
        alert("Withdrawal processed successfully.");
    } catch (e) {
        alert("Error during withdrawal: " + e.message);
    }
}

/**
 * Adds a new borrower to the loans list.
 */
function addNewLoanPerson() {
    const name = prompt("Enter the borrower's name:");
    if (name) {
        appData.loans.push({
            id: generateId(),
            name: name,
            given: [],
            recovered: [],
            netOwedToMe: 0
        });
        saveData();
        renderApp('loans');
    }
}

/**
 * Opens the loan transaction modal for a specific borrower and type.
 * @param {string} loanId
 * @param {string} type 'Give' or 'Recovery'
 */
function addLoanTransaction(loanId, type) {
    document.getElementById('loan-person-id').value = loanId;
    document.querySelector(`#tab-${type.toLowerCase()}`).checked = true;
    document.getElementById('loan-trans-date').value = getCurrentDate();
    showModal('loan-transaction-modal');
}

/**
 * Handles adding a loan transaction (Give/Recovery).
 * @param {Event} event
 */
function handleLoanTransaction(event) {
    event.preventDefault();

    const type = document.querySelector('input[name="loan-transaction-type"]:checked').value;
    const loanId = document.getElementById('loan-person-id').value;
    const amount = parseFloat(document.getElementById('loan-trans-amount').value);
    const date = document.getElementById('loan-trans-date').value || getCurrentDate();
    const notes = document.getElementById('loan-trans-notes').value;
    const bankAccount = appData.accounts[0];

    const loan = appData.loans.find(l => l.id === loanId);

    if (!loan || amount <= 0) {
        alert("Invalid borrower or amount.");
        return;
    }

    const transactionId = generateId();

    if (type === 'Give') {
        if (amount > bankAccount.balance) {
            alert(`Cannot give ₹${amount}. Bank balance is only ${formatCurrency(bankAccount.balance)}.`);
            return;
        }
        loan.given.push({ amount, date, notes, id: transactionId });
        bankAccount.balance -= amount;
        bankAccount.transactions.push({ id: transactionId, type: 'Loan Give', amount: -amount, date, description: `Gave loan to ${loan.name}. ${notes || ''}`, linkedLoanId: loanId });
    } else if (type === 'Recovery') {
        if (amount > loan.netOwedToMe) {
            alert(`Cannot recover ₹${amount}. Owed is only ${formatCurrency(loan.netOwedToMe)}.`);
            return;
        }
        loan.recovered.push({ amount, date, notes, id: transactionId });
        bankAccount.balance += amount;
        bankAccount.transactions.push({ id: transactionId, type: 'Loan Recovery', amount, date, description: `Recovered loan from ${loan.name}. ${notes || ''}`, linkedLoanId: loanId });
    }

    recalculateLoanNetOwed(loanId);
    saveData();
    hideModal('loan-transaction-modal');
    document.getElementById('loan-transaction-form').reset();
    renderApp('loans');
    updateGlobalMetrics();
    alert(`${type} of ${formatCurrency(amount)} successfully recorded!`);
}

/**
 * Deletes a borrower from the loans list.
 * @param {string} loanId
 */
function deleteLoanPerson(loanId) {
    if (confirm("Are you sure you want to delete this borrower? All associated data will be lost.")) {
        appData.loans = appData.loans.filter(l => l.id !== loanId);
        saveData();
        renderApp('loans');
    }
}

/**
 * Deletes a loan transaction and reverses its effect.
 * @param {string} loanId
 * @param {string} txId
 * @param {string} type 'Give' or 'Recovery'
 */
function deleteLoanTransaction(loanId, txId, type) {
    if (!confirm("Are you sure you want to delete this transaction?")) return;

    const loan = appData.loans.find(l => l.id === loanId);
    if (!loan) return;

    if (type === 'Give') {
        loan.given = loan.given.filter(t => t.id !== txId);
    } else if (type === 'Recovery') {
        loan.recovered = loan.recovered.filter(t => t.id !== txId);
    }

    const bankAccount = appData.accounts[0];
    const bankTx = bankAccount.transactions.find(tx => tx.id === txId);
    if (bankTx) {
        bankAccount.balance -= bankTx.amount; // Reverse effect
        bankAccount.transactions = bankAccount.transactions.filter(tx => tx.id !== txId);
    }

    recalculateLoanNetOwed(loanId);
    saveData();
    showLoanDetail(loanId); // Refresh detail modal
    updateGlobalMetrics();
}

/**
 * Edits a loan transaction.
 * @param {string} loanId
 * @param {string} txId
 * @param {string} type 'Give' or 'Recovery'
 */
function editLoanTransaction(loanId, txId, type) {
    const loan = appData.loans.find(l => l.id === loanId);
    const tx = (type === 'Give' ? loan.given : loan.recovered).find(t => t.id === txId);
    if (!tx) return;

    const newAmount = parseFloat(prompt("Edit Amount:", tx.amount));
    const newDate = prompt("Edit Date:", tx.date);
    const newNotes = prompt("Edit Notes:", tx.notes);

    if (newAmount > 0 && newDate) {
        const bankAccount = appData.accounts[0];
        const bankTx = bankAccount.transactions.find(btx => btx.id === txId);
        if (bankTx) {
            bankAccount.balance -= bankTx.amount; // Reverse old
            bankTx.amount = (type === 'Give' ? -newAmount : newAmount);
            bankTx.date = newDate;
            bankTx.description = `${type === 'Give' ? 'Gave loan to' : 'Recovered loan from'} ${loan.name}. ${newNotes || ''}`;
            bankAccount.balance += bankTx.amount; // Apply new
        }

        tx.amount = newAmount;
        tx.date = newDate;
        tx.notes = newNotes;

        recalculateLoanNetOwed(loanId);
        saveData();
        showLoanDetail(loanId);
        updateGlobalMetrics();
    }
}

/**
 * Shows detailed modal for a loan borrower.
 * @param {string} loanId
 */
function showLoanDetail(loanId) {
    const loan = appData.loans.find(l => l.id === loanId);
    if (!loan) return;

    recalculateLoanNetOwed(loanId);

    const totalGiven = loan.given.reduce((sum, t) => sum + t.amount, 0);
    const totalRecovered = loan.recovered.reduce((sum, t) => sum + t.amount, 0);

    const allLoanTransactions = [
        ...loan.given.map(t => ({ ...t, type: 'Give' })),
        ...loan.recovered.map(t => ({ ...t, type: 'Recovery' }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    let detailContent = `
        <span class="close-btn" onclick="hideModal('shortfall-modal')">&times;</span>
        <h3>Summary for ${loan.name}</h3>
        <div class="card-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 15px;">
            <div class="card"><strong>Total Given:</strong><br><span class="amount negative">${formatCurrency(totalGiven)}</span></div>
            <div class="card"><strong>Total Recovered:</strong><br><span class="amount positive">${formatCurrency(totalRecovered)}</span></div>
            <div class="card"><strong>Net Owed to You:</strong><br><span class="amount ${loan.netOwedToMe > 0 ? 'positive' : 'balance'}">${formatCurrency(loan.netOwedToMe)}</span></div>
        </div>
        <h3>Full Transaction History</h3>
        <ul class="transaction-log">
    `;

    if (allLoanTransactions.length === 0) {
        detailContent += `<li class="log-item">No transactions recorded for this borrower.</li>`;
    } else {
        allLoanTransactions.forEach(t => {
            const isPositive = t.type === 'Recovery';
            const amountDisplay = isPositive ? formatCurrency(t.amount) : `-${formatCurrency(t.amount)}`;
            detailContent += `
                <li class="log-item">
                    <div>
                        <span>${t.date} - <strong>${t.type}</strong>: ${t.notes || 'No notes'}</span>
                    </div>
                    <div class="log-item-actions">
                        <span class="log-amount ${t.type}">${amountDisplay}</span>
                        <button class="btn-edit-tx" onclick="editLoanTransaction('${loan.id}', '${t.id}', '${t.type}')">✏️</button>
                        <button class="btn-delete-tx" onclick="deleteLoanTransaction('${loan.id}', '${t.id}', '${t.type}')">🗑️</button>
                    </div>
                </li>
            `;
        });
    }
    detailContent += `</ul>`;

    const modal = document.getElementById('shortfall-modal');
    document.getElementById('shortfall-title').textContent = `Detail for ${loan.name}`;
    document.getElementById('shortfall-form').style.display = 'none';
    document.getElementById('shortfall-result').innerHTML = detailContent;
    showModal('shortfall-modal');
}

/**
 * Handles adding more funds to an existing investment (New Feature).
 * @param {string} investmentId
 */
function handleAddMoreFunds(investmentId) {
    const investment = appData.investments.find(i => i.id === investmentId);
    if (!investment) return alert("Investment not found.");

    const modal = document.getElementById('transaction-modal');
    // Pre-set modal for investment, but simplify the form for this specific action
    document.querySelector('#tab-investment').checked = true;
    document.getElementById('investment-fields').style.display = 'block';
    
    document.getElementById('invest-name').value = investment.name;
    document.getElementById('invest-name').disabled = true; // Prevent changing name
    document.getElementById('trans-notes').placeholder = `Additional funds for ${investment.name}`;
    document.getElementById('transaction-form').onsubmit = (e) => {
        e.preventDefault();
        
        const personId = document.getElementById('trans-person').value;
        const amount = parseFloat(document.getElementById('trans-amount').value);
        const date = document.getElementById('trans-date').value || getCurrentDate();
        const notes = document.getElementById('trans-notes').value;
        const bankAccount = appData.accounts[0];
        const person = appData.people.find(p => p.id === personId);

        if (!personId || amount <= 0) return alert("Please select a person and enter a valid amount.");
        if (amount > person.netOwed) return alert(`${person.name}'s liquid available (${formatCurrency(person.netOwed)}) is less than this contribution (${formatCurrency(amount)}).`);
        if (amount > bankAccount.balance) return alert(`Bank balance is only ${formatCurrency(bankAccount.balance)}.`);

        // 1. Update Investment
        investment.totalAmount += amount;
        
        // Update contributor list (or add if new contributor)
        const existingContributor = investment.contributors.find(c => c.personId === personId);
        if (existingContributor) {
            existingContributor.amount += amount;
        } else {
            investment.contributors.push({ personId, amount });
        }
        
        // Log transaction inside the investment
        investment.transactions.push({ type: 'Additional Contribution', amount, date, contributorId: personId, notes });

        // 2. Update Person
        person.invested.push({ amount, investmentId, date, id: generateId() });
        recalculatePersonNetOwed(personId);

        // 3. Update Account
        bankAccount.balance -= amount;
        bankAccount.transactions.push({ type: 'Investment', amount: -amount, date, description: `Added funds to ${investment.name} (from ${person.name}).`, investmentId });

        saveData();
        hideModal('transaction-modal');
        document.getElementById('transaction-form').reset();
        document.getElementById('invest-name').disabled = false; // Re-enable for next general transaction
        alert(`Successfully added ${formatCurrency(amount)} to ${investment.name}.`);
        renderApp('investments');
    };

    populatePersonDropdown('trans-person');
    showModal('transaction-modal');
}

/**
 * Deletes a transaction after confirmation.
 * This is a complex operation that must reverse the transaction's effects.
 * @param {string} personId
 * @param {string} transactionId
 * @param {string} transactionType 'Receipt', 'Return', or 'Investment'
 */
function deleteTransaction(personId, transactionId, transactionType, silent = false) {
    if (!silent && !confirm(`Are you sure you want to delete this ${transactionType} transaction? This action cannot be undone.`)) {
        return;
    }

    const person = appData.people.find(p => p.id === personId);
    const bankAccount = appData.accounts[0];
    if (!person) return alert("Error: Person not found.");

    let transaction;
    let transactionIndex;

    try {
        if (transactionType === 'Receipt') {
            transactionIndex = person.received.findIndex(t => t.id === transactionId);
            if (transactionIndex === -1) throw new Error("Receipt transaction not found.");
            transaction = person.received[transactionIndex];

            // Reverse effects
            bankAccount.balance -= transaction.amount;
            person.received.splice(transactionIndex, 1);

        } else if (transactionType === 'Return') {
            transactionIndex = person.returned.findIndex(t => t.id === transactionId);
            if (transactionIndex === -1) throw new Error("Return transaction not found.");
            transaction = person.returned[transactionIndex];

            // Reverse effects
            bankAccount.balance += transaction.amount;
            person.returned.splice(transactionIndex, 1);

        } else if (transactionType === 'Investment') {
            transactionIndex = person.invested.findIndex(t => t.id === transactionId);
            if (transactionIndex === -1) throw new Error("Investment transaction not found.");
            transaction = person.invested[transactionIndex];

            // Reverse effects
            bankAccount.balance += transaction.amount;
            person.invested.splice(transactionIndex, 1);

            const investment = appData.investments.find(i => i.id === transaction.investmentId);
            if (investment) {
                // Case 1: The investment was a simple, single-contribution one. Delete the whole thing.
                if (investment.contributors.length === 1 && investment.transactions.length === 1 && investment.contributors[0].personId === personId && investment.contributors[0].amount === transaction.amount) {
                    const investmentIndex = appData.investments.findIndex(i => i.id === transaction.investmentId);
                    if (investmentIndex > -1) {
                        appData.investments.splice(investmentIndex, 1);
                    }
                } else {
                // Case 2: This is a contribution to a multi-part investment. Reverse the contribution carefully.
                    investment.totalAmount -= transaction.amount;

                    // Find and update the contributor's total in the investment
                    const contributorInInvestment = investment.contributors.find(c => c.personId === personId);
                    if (contributorInInvestment) {
                        contributorInInvestment.amount -= transaction.amount;
                    }

                    // Find and remove the specific transaction from the investment's internal log.
                    // We match by amount, date, and person. This is fragile but necessary with current data structure.
                    const internalTxIndex = investment.transactions.findIndex(itx => itx.contributorId === personId && itx.amount === transaction.amount && itx.date === transaction.date);
                    if (internalTxIndex > -1) {
                        investment.transactions.splice(internalTxIndex, 1);
                    }
                }
            }
        }

        // Remove from the main bank account transaction log
        const bankTransactionIndex = bankAccount.transactions.findIndex(t => t.id === transactionId);
        if (bankTransactionIndex > -1) {
            bankAccount.transactions.splice(bankTransactionIndex, 1);
        }

        // Recalculate and save
        recalculatePersonNetOwed(personId);
        saveData();

        // Re-render the person detail modal to show the change
        showPersonDetail(personId);
        if (!silent) {
            // Also re-render the main app view to reflect changes in other tabs (like Account Log)
            const currentView = document.querySelector('nav button.active').id.replace('nav-', '');
            renderApp(currentView);
            alert("Transaction successfully deleted.");
        }

    } catch (error) {
        console.error("Deletion failed:", error);
        alert(`Error deleting transaction: ${error.message}`);
    }
}

/**
 * Prepares the transaction modal for editing an existing transaction.
 * @param {string} personId
 * @param {string} transactionId
 * @param {string} transactionType 'Receipt', 'Return', or 'Investment'
 */
function editTransaction(personId, transactionId, transactionType) {
    const person = appData.people.find(p => p.id === personId);
    if (!person) return;

    let transaction;
    if (transactionType === 'Receipt') transaction = person.received.find(t => t.id === transactionId);
    else if (transactionType === 'Return') transaction = person.returned.find(t => t.id === transactionId);
    else if (transactionType === 'Investment') {
        transaction = person.invested.find(t => t.id === transactionId);
        // For investments, we also need the investment's name.
        const investment = appData.investments.find(i => i.id === transaction?.investmentId);
        if (investment) {
            transaction.investmentName = investment.name;
            transaction.notes = investment.notes; // The simple investment notes are stored here
        }
    }

    if (!transaction) return alert("Transaction not found.");

    // First, delete the old transaction without confirmation
    // We need to do this silently without the confirmation prompt or success alert.
    // A more robust implementation would have a dedicated internal "silentDelete" function.
    // For now, we'll proceed with the standard delete.
    const originalConfirm = window.confirm;
    window.confirm = () => true; // Temporarily bypass confirmation
    deleteTransaction(personId, transactionId, transactionType, true); // Pass silent flag
    window.confirm = originalConfirm; // Restore original confirm function

    // Now, open the modal and pre-fill it with the old data to be re-submitted
    showModal('transaction-modal');

    // Populate form fields
    document.getElementById('trans-person').value = personId;
    document.getElementById('trans-amount').value = transaction.amount;
    document.getElementById('trans-date').value = transaction.date;
    document.getElementById('trans-notes').value = transaction.notes || '';

    alert("The original transaction has been deleted. Please review and re-submit the details to save your changes.");

    // Select the correct tab and populate specific fields
    const tabId = `tab-${transactionType.toLowerCase()}`;
    document.getElementById(tabId).checked = true;
    // Trigger change event to ensure UI consistency (e.g., show/hide investment fields)
    document.getElementById(tabId).dispatchEvent(new Event('change'));

    if (transactionType === 'Investment') {
        document.getElementById('invest-name').value = transaction.investmentName || '';
    }
}

// --- UI RENDERING & DOM MANIPULATION ---

/**
 * Shows a modal by its ID.
 * @param {string} modalId
 */
function showModal(modalId) {
    // Always repopulate the person dropdown when a modal that might use it is shown.
    // This ensures the list and net owed amounts are always current.
    if (modalId === 'transaction-modal') {
        populatePersonDropdown('trans-person');
    }

    document.getElementById(modalId).style.display = 'block';
    // Set current date for date fields upon showing a modal
    const dateInput = document.getElementById('trans-date');
    if(dateInput) dateInput.value = getCurrentDate();
}

/**
 * Hides a modal by its ID.
 * @param {string} modalId
 */
function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    // If we are closing the transaction modal, always reset its form's onsubmit handler
    // to the default. This prevents the 'handleAddMoreFunds' override from persisting.
    if (modalId === 'transaction-modal') {
        document.getElementById('transaction-form').onsubmit = handleTransaction;
    }
}

/**
 * Populates a select element with people options.
 * @param {string} selectId
 */
function populatePersonDropdown(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select Person --</option>';
    appData.people.forEach(person => {
        const option = document.createElement('option');
        option.value = person.id;
        option.textContent = `${person.name} (Net Owed: ${formatCurrency(person.netOwed)})`;
        select.appendChild(option);
    });
}

/**
 * Primary navigation and rendering function.
 * @param {string} view 'dashboard', 'people', 'investments', or 'accounts'
 */
function renderApp(view) {
    const content = document.getElementById('app-content');
    content.innerHTML = '';

    // Update active navigation button
    document.querySelectorAll('header nav button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`nav-${view}`).classList.add('active');
    
    if (view === 'dashboard') {
        renderDashboard(content);
    } else if (view === 'people') {
        renderPeopleLedger(content);
    } else if (view === 'investments') {
        renderInvestmentPortfolio(content);
    } else if (view === 'loans') {
        renderLoansGiven(content);
    } else if (view === 'accounts') {
        renderAccountLog(content);
    }

    updateGlobalMetrics();
}

/**
 * Renders the Dashboard View.
 * @param {HTMLElement} content
 */
function renderDashboard(content) {
    content.innerHTML = `<h2>Dashboard Overview</h2>`;

    const bankBalance = appData.accounts[0] ? appData.accounts[0].balance : 0;
    const liquidObligations = calculateTotalLiquidObligations();
    const totalInvested = calculateTotalInvested();
    const totalOwed = appData.people.reduce((sum, p) => sum + Math.max(0, p.netOwed + p.invested.reduce((s,i) => s + i.amount, 0)), 0);
    const netWorth = bankBalance + totalInvested - totalOwed;

    content.innerHTML += `
        <div class="card-grid">
            <div class="card">
                <h3>Current Bank Balance</h3>
                <span class="amount balance">${formatCurrency(bankBalance)}</span>
            </div>
            <div class="card">
                <h3>Total Owed to Others</h3>
                <span class="amount ${totalOwed > 0 ? 'negative' : 'positive'}">${formatCurrency(totalOwed)}</span>
            </div>
            <div class="card">
                <h3>Total Funds Invested</h3>
                <span class="amount positive">${formatCurrency(totalInvested)}</span>
            </div>
            <div class="card">
                <h3>Estimated Net Worth</h3>
                <span class="amount ${netWorth >= 0 ? 'positive' : 'negative'}">${formatCurrency(netWorth)}</span>
            </div>
        </div>
        
        <div class="chart-grid" style="margin-top: 30px;">
            <div>
                <h3>Total Owed Funds by Person</h3>
                <canvas id="total-owed-chart"></canvas>
            </div>
            <div>
                <h3>Portfolio Allocation by Investment</h3>
                <canvas id="invested-funds-chart"></canvas>
            </div>
            <div>
                <h3>Loans Given Distribution</h3>
                <canvas id="loans-given-chart"></canvas>
            </div>
        </div>
        <h3 style="margin-top: 30px;">Recent Activity</h3>
        <ul id="recent-activity-list" class="transaction-log"></ul>
    `;

    // Render Recent Activity (last 5 account transactions)
    const recentActivityList = document.getElementById('recent-activity-list');
    const allTransactions = appData.accounts[0].transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    allTransactions.slice(0, 5).forEach(t => {
        const person = appData.people.find(p => p.id === t.linkedPersonId)?.name || 'N/A';
        const investment = appData.investments.find(i => i.id === t.investmentId)?.name || 'N/A';
        const description = t.description || (t.type === 'Receipt' ? `Received from ${person}` : `Used for ${investment}`);
        
        recentActivityList.innerHTML += `
            <li class="log-item">
                <span>${t.date} - <strong>${t.type}</strong>: ${description}</span>
                <span class="log-amount ${t.type}">${formatCurrency(t.amount)}</span>
            </li>
        `;
    });
    
    // --- Chart 1: Total Owed by Person ---
    const owedData = appData.people.map(p => {
        const liquidOwedToPerson = Math.max(0, p.netOwed);
        return { name: p.name, amount: liquidOwedToPerson };
    }).filter(p => p.amount > 0);

    if (totalOwedChart) totalOwedChart.destroy();
    const totalOwedCtx = document.getElementById('total-owed-chart').getContext('2d');
    totalOwedChart = new Chart(totalOwedCtx, {
        type: 'doughnut',
        data: {
            labels: owedData.map(p => p.name),
            datasets: [{
                label: 'Liquid Owed',
                data: owedData.map(p => p.amount),
                backgroundColor: generateColors(owedData.length),
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                },
                title: {
                    display: true,
                    text: `Total: ${formatCurrency(liquidObligations)}`
                }
            }
        }
    });

    // --- Chart 2: Invested Funds by Investment Name ---
    const investedData = appData.investments.map(inv => {
        return { name: inv.name, amount: inv.totalAmount };
    }).filter(inv => inv.amount > 0);

    if (investedFundsChart) investedFundsChart.destroy();
    const investedFundsCtx = document.getElementById('invested-funds-chart').getContext('2d');
    investedFundsChart = new Chart(investedFundsCtx, {
        type: 'doughnut',
        data: {
            labels: investedData.map(p => p.name),
            datasets: [{
                label: 'Amount Invested',
                data: investedData.map(p => p.amount),
                backgroundColor: generateColors(investedData.length),
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                },
                title: {
                    display: true,
                    text: `Total: ${formatCurrency(totalInvested)}`
                },
                tooltip: {
                    callbacks: {
                        // The 'title' callback sets the main title of the tooltip (e.g., "ITC Share")
                        title: function(context) {
                            return context[0].label;
                        },
                        // The 'label' callback creates the detailed breakdown lines below the title
                        label: function(context) {
                            const investmentIndex = context.dataIndex;
                            const investment = appData.investments.filter(inv => inv.totalAmount > 0)[investmentIndex];
                            
                            if (investment && investment.contributors) {
                                // We return an array of strings, and Chart.js will render each as a new line.
                                const contributorLines = investment.contributors.map(c => {
                                    const person = appData.people.find(p => p.id === c.personId);
                                    return `${person ? person.name : 'Unknown'}: ${formatCurrency(c.amount)}`;
                                });
                                return contributorLines;
                            }
                            return `Total: ${formatCurrency(context.parsed)}`;
                        }
                    }
                }
            }
        }
    });
    // Loans Given Distribution Chart
    if (loansGivenChart) loansGivenChart.destroy();
    const loansData = appData.loans.map(l => ({
        label: l.name,
        value: l.netOwedToMe
    })).filter(d => d.value > 0);
    if (loansData.length > 0) {
        const loansLabels = loansData.map(d => d.label);
        const loansValues = loansData.map(d => d.value);
        const loansColors = generateColors(loansData.length);
        loansGivenChart = new Chart(document.getElementById('loans-given-chart'), {
            type: 'pie',
            data: {
                labels: loansLabels,
                datasets: [{
                    data: loansValues,
                    backgroundColor: loansColors
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'top' },
                    title: { display: true, text: `Total Loans Given: ${formatCurrency(loansValues.reduce((a, b) => a + b, 0))}` }
                }
            }
        });
    }
}

/**
 * Removes investments with zero or negative totalAmount to clean up data and prevent duplicates/empty entries.
 */
function cleanZeroInvestments() {
    appData.investments = appData.investments.filter(inv => inv.totalAmount > 0);
    saveData(); // Persist the cleanup
}

/**
 * Renders the People Ledger View.
 * @param {HTMLElement} content
 */
function renderPeopleLedger(content) {
    content.innerHTML = '<h2>👥 People Management & Ledger</h2><div class="list-container" id="people-list-container"></div>';
    const listContainer = document.getElementById('people-list-container');
    
    // Add button to add a new person
    const addPersonBtn = document.createElement('button');
    addPersonBtn.textContent = '+ Add New Person';
    addPersonBtn.classList.add('btn-primary');
    addPersonBtn.style.marginBottom = '15px';
    addPersonBtn.onclick = () => {
        const name = prompt("Enter the name of the new person/entity:");
        if (name && name.trim()) {
            appData.people.push({
                id: generateId(),
                name: name.trim(),
                received: [],
                returned: [],
                invested: [],
                netOwed: 0,
                notes: '',
                createdAt: getCurrentDate()
            });
            saveData();
            renderApp('people');
        }
    };
    listContainer.before(addPersonBtn);

    appData.people.forEach(person => {
        recalculatePersonNetOwed(person.id); // Ensure netOwed is fresh
        const totalInvested = person.invested.reduce((sum, t) => sum + t.amount, 0);
        const liquidOwed = person.netOwed; // Net Owed is the liquid portion after investments

        const item = document.createElement('div');
        item.classList.add('list-item');
        item.style.borderLeftColor = liquidOwed > 0 ? varStyle('--color-negative') : varStyle('--color-positive');

        item.innerHTML = `
            <div class="list-item-content">
                <h4>${person.name}</h4>
                <p><strong>Net Liquid Owed:</strong> <span class="amount ${liquidOwed > 0 ? 'negative' : 'positive'}">${formatCurrency(liquidOwed)}</span></p>
                <p><strong>Total Invested for them:</strong> <span class="amount positive">${formatCurrency(totalInvested)}</span></p>
            </div>
            <div class="list-item-actions">
                <button onclick="showPersonDetail('${person.id}')">View Details</button>
                <button onclick="prepareWithdrawalSimulation('${person.id}')">Simulate Withdrawal</button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

/**
 * Shows a detailed modal for a specific person.
 * @param {string} personId
 */
function showPersonDetail(personId) {
    const person = appData.people.find(p => p.id === personId);
    if (!person) return;

    // --- Calculations ---
    const totalReceived = person.received.reduce((sum, t) => sum + t.amount, 0);
    const totalReturned = person.returned.reduce((sum, t) => sum + t.amount, 0);
    const totalInvested = person.invested.reduce((sum, t) => sum + t.amount, 0);

    // --- Combine and sort all transactions for this person ---
    const allPersonTransactions = [
        ...person.received.map(t => ({ ...t, type: 'Receipt' })),
        ...person.returned.map(t => ({ ...t, type: 'Return' })),
        ...person.invested.map(t => {
            const investment = appData.investments.find(i => i.id === t.investmentId);
            return { ...t, type: 'Investment', notes: `Invested in ${investment ? investment.name : 'Unknown'}` };
        })
    ].sort((a, b) => new Date(b.date) - new Date(a.date)); // Newest first

    // --- Build Modal Content ---
    let detailContent = `
        <span class="close-btn" onclick="hideModal('shortfall-modal')">&times;</span>
        <h2>${person.name}'s Ledger Detail</h2>
        
        <h3>Summary</h3>
        <div class="card-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 15px;">
            <div class="card"><strong>Total Received:</strong><br><span class="amount positive">${formatCurrency(totalReceived)}</span></div>
            <div class="card"><strong>Total Returned:</strong><br><span class="amount negative">${formatCurrency(totalReturned)}</span></div>
            <div class="card"><strong>Total Invested:</strong><br><span class="amount negative">${formatCurrency(totalInvested)}</span></div>
            <div class="card"><strong>Net Owed (Liquid):</strong><br><span class="amount ${person.netOwed > 0 ? 'negative' : 'positive'}">${formatCurrency(person.netOwed)}</span></div>
        </div>

        <h3>Full Breakdown Explanation</h3>
        <p>You currently owe <strong>${formatCurrency(person.netOwed)}</strong> in liquid funds to ${person.name}.</p>
        <p>Total funds received from them: <strong>${formatCurrency(totalReceived)}</strong>.</p>
        <p>Funds returned to them: <strong>${formatCurrency(totalReturned)}</strong>.</p>
        <p>Funds currently tied up in investments for them: <strong>${formatCurrency(totalInvested)}</strong>. See details below.</p>
        
        <h3>Active Investments</h3>
        <ul class="transaction-log">
    `;

    const personInvestments = person.invested.map(invRecord => {
        const investment = appData.investments.find(i => i.id === invRecord.investmentId);
        return { ...invRecord, investment };
    }).filter(i => i.investment); // Filter out any orphaned investment records

    if (personInvestments.length === 0) {
        detailContent += `<li class="log-item">No active investments for this person.</li>`;
    } else {
        personInvestments.forEach(inv => {
            detailContent += `
                <li class="log-item">
                    <div>
                        <span>${inv.date} - <strong>Investment</strong>: Contributed to ${inv.investment.name}</span>
                    </div>
                    <div class="log-item-actions">
                        <span class="log-amount Investment">-${formatCurrency(inv.amount)}</span>
                        <button class="btn-edit-tx" onclick="editTransaction('${person.id}', '${inv.id}', 'Investment')">✏️</button>
                        <button class="btn-delete-tx" onclick="deleteTransaction('${person.id}', '${inv.id}', 'Investment')">🗑️</button>
                    </div>
                </li>`;
        });
    }
    detailContent += `</ul><h3 style="margin-top: 20px;">Full Transaction History</h3>
        <ul class="transaction-log">
    `;

    if (allPersonTransactions.length === 0) {
        detailContent += `<li class="log-item">No transactions recorded for this person.</li>`;
    } else {
        allPersonTransactions.forEach(t => {
            const isNegative = t.type === 'Return' || t.type === 'Investment';
            const amountDisplay = isNegative ? `-${formatCurrency(t.amount)}` : formatCurrency(t.amount);
            detailContent += `
                <li class="log-item">
                    <div>
                        <span>${t.date} - <strong>${t.type}</strong>: ${t.notes || 'No notes'}</span>
                    </div>
                    <div class="log-item-actions">
                        <span class="log-amount ${t.type}">${amountDisplay}</span>
                        <button class="btn-edit-tx" onclick="editTransaction('${person.id}', '${t.id}', '${t.type}')">✏️</button>
                        <button class="btn-delete-tx" onclick="deleteTransaction('${person.id}', '${t.id}', '${t.type}')">🗑️</button>
                    </div>
                </li>
            `;
        });
    }
    detailContent += `</ul>`;

    // --- Render Modal ---
    const modal = document.getElementById('shortfall-modal');
    document.getElementById('shortfall-form').style.display = 'none'; // Hide the simulation form
    document.getElementById('shortfall-result').innerHTML = detailContent;

    showModal('shortfall-modal');
}

/**
 * Prepares the Withdrawal Simulation Modal.
 * @param {string} personId
 */
function prepareWithdrawalSimulation(personId) {
    const person = appData.people.find(p => p.id === personId);
    if (!person) return;
    
    document.getElementById('shortfall-person-id').value = personId;
    document.getElementById('shortfall-title').textContent = `Simulate Withdrawal for ${person.name}`;
    document.getElementById('shortfall-form').style.display = 'block';
    document.getElementById('shortfall-result').innerHTML = '';
    document.getElementById('shortfall-amount').value = '';
    
    showModal('shortfall-modal');
}

/**
 * Simulates a withdrawal request and explains shortfalls.
 * @param {Event} event
 */
function simulateWithdrawal(event) {
    event.preventDefault();

    const personId = document.getElementById('shortfall-person-id').value;
    const requestedAmount = parseFloat(document.getElementById('shortfall-amount').value);
    const person = appData.people.find(p => p.id === personId);

    if (!person || requestedAmount <= 0) return;

    // 1. Calculate liquid available
    const liquidAvailable = person.netOwed;
    
    // 2. Determine shortfall
    let shortfall = 0;
    if (requestedAmount > liquidAvailable) {
        shortfall = requestedAmount - liquidAvailable;
    }

    let resultHtml = `<h3>Simulation Results for ${formatCurrency(requestedAmount)} Request</h3>`;

    if (shortfall === 0) {
        resultHtml += `<p class="alert-message" style="background-color: #c8e6c9; color: var(--color-positive);">✅ **Success!** ${formatCurrency(requestedAmount)} is fully covered by the **${formatCurrency(liquidAvailable)}** liquid funds available.</p>`;
    } else {
        resultHtml += `<p class="alert-message">⚠️ **Shortfall Alert!** Requested amount exceeds liquid funds.</p>`;
        resultHtml += `<p>Liquid funds available: **${formatCurrency(liquidAvailable)}**</p>`;
        resultHtml += `<p>Remaining shortfall to cover: **${formatCurrency(shortfall)}**</p>`;
        
        resultHtml += `<h4>Shortfall Explanation (Funds tied up in investments):</h4><ul>`;
        
        let remainingShortfall = shortfall;
        
        // Use invested funds to explain the shortfall
        person.invested.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(inv => {
            if (remainingShortfall > 0) {
                const investment = appData.investments.find(i => i.id === inv.investmentId);
                const amountCovered = Math.min(remainingShortfall, inv.amount);
                
                resultHtml += `<li>**${formatCurrency(amountCovered)}** is tied up in *${investment ? investment.name : 'Unknown'}* (Total: ${formatCurrency(inv.amount)}) on ${inv.date}.</li>`;
                
                remainingShortfall -= amountCovered;
            }
        });

        if (remainingShortfall > 0) {
             resultHtml += `<li>**${formatCurrency(remainingShortfall)}** shortfall remains unexplained by current investment records.</li>`;
        }
        
        resultHtml += `</ul>`;
    }

    document.getElementById('shortfall-result').innerHTML = resultHtml;
}

/**
 * Renders the Investment Portfolio View.
 * @param {HTMLElement} content
 */
function renderInvestmentPortfolio(content) {
    content.innerHTML = '<h2>📈 Investment Portfolio</h2><div class="list-container" id="investment-list-container"></div>';
    const listContainer = document.getElementById('investment-list-container');
    
    // Add button to add a new multi-contributor investment
    const addInvestmentBtn = document.createElement('button');
    addInvestmentBtn.textContent = '+ Add New Multi-Contributor Investment';
    addInvestmentBtn.classList.add('btn-primary');
    addInvestmentBtn.style.marginBottom = '15px';
    addInvestmentBtn.onclick = () => showInvestmentModal('create');
    listContainer.before(addInvestmentBtn);

    cleanZeroInvestments();
    appData.investments.forEach(investment => {
        const item = document.createElement('div');
        item.classList.add('list-item');
        item.style.borderLeftColor = varStyle('--color-positive');

        const contributorNames = investment.contributors.map(c => appData.people.find(p => p.id === c.personId)?.name || 'Unknown').join(', ');
        
        item.innerHTML = `
            <div class="list-item-content">
                <h4>${investment.name} (Active)</h4>
                <p><strong>Total Invested:</strong> <span class="amount positive">${formatCurrency(investment.totalAmount)}</span></p>
                <p><strong>Contributors:</strong> ${contributorNames}</p>
                <button onclick="showInvestmentModal('edit', '${investment.id}')">Edit</button>
                <button onclick="showWithdrawModal('${investment.id}')">Withdraw</button>
            </div>
            <div class="list-item-actions">
                <button onclick="handleAddMoreFunds('${investment.id}')">Add More Funds</button>
                <button onclick="showInvestmentDetail('${investment.id}')">View History</button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

/**
 * Shows a detailed modal for an investment's history and contributors.
 * @param {string} investmentId
 */
function showInvestmentDetail(investmentId) {
    const investment = appData.investments.find(i => i.id === investmentId);
    if (!investment) return;

    let detailContent = `
        <span class="close-btn" onclick="hideModal('shortfall-modal')">&times;</span>
        <h2>${investment.name} Detail</h2>
        
        <h3>Summary</h3>
        <div class="card-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 15px;">
            <div class="card"><strong>Total Invested:</strong> <span class="amount positive">${formatCurrency(investment.totalAmount)}</span></div>
            <div class="card"><strong>Original Date:</strong> <span>${investment.date}</span></div>
        </div>
        
        <h3>Contributor Breakdown</h3>
        <ul class="transaction-log">
    `;

    investment.contributors.forEach(c => {
        const person = appData.people.find(p => p.id === c.personId);
        detailContent += `<li class="log-item"><span>${person ? person.name : 'Unknown'}</span><span class="log-amount Receipt">${formatCurrency(c.amount)}</span></li>`;
    });
    detailContent += `</ul>`;

    detailContent += `
        <h3 style="margin-top: 15px;">Transaction History</h3>
        <ul class="transaction-log">
    `;

    investment.transactions.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(t => {
        const contributorName = t.contributorId === 'MULTI' ? 'Multiple' : (appData.people.find(p => p.id === t.contributorId)?.name || 'Unknown');
        detailContent += `
            <li class="log-item">
                <span>${t.date} - <strong>${t.type}</strong> from ${contributorName}</span>
                <span class="log-amount Receipt">${formatCurrency(t.amount)}</span>
            </li>
        `;
    });
    detailContent += `</ul>`;

    // Re-use shortfall modal structure
    const modal = document.getElementById('shortfall-modal');
    document.getElementById('shortfall-title').textContent = `${investment.name} Detail`;
    document.getElementById('shortfall-form').style.display = 'none'; 
    document.getElementById('shortfall-result').innerHTML = detailContent;

    showModal('shortfall-modal');
}


/**
 * Renders the Account Ledger View.
 * @param {HTMLElement} content
 */
function renderAccountLog(content) {
    const bankAccount = appData.accounts[0];
    const totalLiquidObligations = calculateTotalLiquidObligations();

    content.innerHTML = `
        <h2>🏦 Account Ledger: ${bankAccount.name}</h2>
        <div class="card-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 15px;">
            <div class="card">
                <h3>Current Balance</h3>
                <span class="amount balance">${formatCurrency(bankAccount.balance)}</span>
            </div>
            <div class="card">
                <h3>Total Liquid Obligations</h3>
                <span class="amount negative">${formatCurrency(totalLiquidObligations)}</span>
            </div>
        </div>
        <p><strong>Effective Liquid Balance:</strong> <span class="amount ${bankAccount.balance >= totalLiquidObligations ? 'positive' : 'negative'}">${formatCurrency(bankAccount.balance - totalLiquidObligations)}</span></p>

        <h3 style="margin-top: 20px;">Full Transaction Log (Chronological)</h3>
        <ul class="transaction-log" id="account-transaction-list"></ul>
    `;

    const transactionList = document.getElementById('account-transaction-list');
    const allTransactions = bankAccount.transactions.sort((a, b) => new Date(b.date) - new Date(a.date)); // Newest first

    allTransactions.forEach(t => {
        const isNegative = t.amount < 0 || t.type === 'Investment' || t.type === 'Return';
        const amountDisplay = isNegative ? formatCurrency(Math.abs(t.amount)) : formatCurrency(t.amount);
        const logClass = isNegative ? 'Return' : 'Receipt';
        const description = t.description || 'N/A';
        
        transactionList.innerHTML += `
            <li class="log-item">
                <span>${t.date} - <strong>${t.type}</strong>: ${description}</span>
                <span class="log-amount ${logClass}">${isNegative ? '-' : ''}${amountDisplay}</span>
            </li>
        `;
    });
}

/**
 * Renders the Loans Given Ledger View.
 * @param {HTMLElement} content
 */
function renderLoansGiven(content) {
    content.innerHTML = '<h2>💸 Loans Given Ledger</h2><div class="list-container" id="loans-list-container"></div>';
    const listContainer = document.getElementById('loans-list-container');

    const addPersonBtn = document.createElement('button');
    addPersonBtn.textContent = '+ Add New Borrower';
    addPersonBtn.classList.add('btn-primary');
    addPersonBtn.style.marginBottom = '15px';
    addPersonBtn.onclick = () => addNewLoanPerson();
    content.insertBefore(addPersonBtn, listContainer);

    appData.loans.forEach(loan => {
        recalculateLoanNetOwed(loan.id);
        const item = document.createElement('div');
        item.classList.add('list-item');
        item.innerHTML = `
            <div class="list-item-content">
                <h4>${loan.name}</h4>
                <span class="amount ${loan.netOwedToMe > 0 ? 'positive' : 'balance'}">${formatCurrency(loan.netOwedToMe)}</span>
            </div>
            <div class="list-item-actions">
                <button onclick="addLoanTransaction('${loan.id}', 'Give')">Give</button>
                <button onclick="addLoanTransaction('${loan.id}', 'Recovery')">Recovery</button>
                <button onclick="showLoanDetail('${loan.id}')">Detail</button>
                <button onclick="deleteLoanPerson('${loan.id}')">Delete</button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

// --- DATA EXPORT/IMPORT ---

/**
 * Exports all application data as a JSON file.
 */
function exportData() {
    const dataStr = JSON.stringify(appData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `ledger_export_${getCurrentDate()}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

/**
 * Imports data from a JSON file selected by the user.
 */
function importData() {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files[0];

    if (!file) {
        alert("Please select a JSON file to import.");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            // Basic validation
            if (importedData.people && importedData.accounts && importedData.investments) {
                if (confirm("WARNING: This will overwrite all your current data. Do you wish to proceed with the import?")) {
                    appData = importedData;
                    saveData();
                    hideModal('settings-modal');
                    renderApp('dashboard');
                    alert("Data successfully imported! Application has been reloaded.");
                }
            } else {
                alert("Invalid JSON structure. File must contain 'people', 'accounts', and 'investments' arrays.");
            }
        } catch (error) {
            alert("Failed to read or parse the JSON file. Please ensure it is a valid JSON file.");
            console.error(error);
        }
    };
    reader.readAsText(file);
}

/**
 * Clears all application data and resets to the initial state after confirmation.
 */
function clearAllData() {
    const confirmation = prompt("DANGER: This will permanently delete ALL data. To confirm, please type 'DELETE' in the box below.");
    if (confirmation === 'DELETE') {
        initializeData(); // This function resets appData and saves the empty state.
        hideModal('settings-modal');
        renderApp('dashboard');
        alert("All data has been cleared. The application is now reset.");
    } else {
        alert("Reset cancelled. Your data is safe.");
    }
}
// --- FOOTER AND CHART HELPERS ---

/**
 * Toggles the expanded view of the dashboard footer.
 */
function toggleFooterDetails() {
    const details = document.getElementById('footer-details');
    const toggleBtn = document.getElementById('footer-toggle');
    if (details.style.display === 'none') {
        details.style.display = 'block';
        toggleBtn.textContent = '⬆️ Summary';
        // Redraw chart when expanded
        renderApp('dashboard'); // Re-render dashboard to re-initialize the chart element correctly
    } else {
        details.style.display = 'none';
        toggleBtn.textContent = '⬇️ Details';
    }
}

/**
 * Generates an array of distinct colors for charts.
 * @param {number} count The number of colors to generate.
 * @returns {string[]} An array of color hex codes.
 */
function generateColors(count) {
    const colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
    const result = [];
    for (let i = 0; i < count; i++) {
        result.push(colors[i % colors.length]);
    }
    return result;
}

// --- INITIALIZATION ---

/**
 * Initializes the entire application on load.
 */
function init() {
    loadData();
    renderApp('dashboard');
    populatePersonDropdown('trans-person');

    // Listener for transaction type change to show/hide investment fields
    document.querySelectorAll('input[name="transaction-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const isInvestment = e.target.value === 'Investment';
            document.getElementById('investment-fields').style.display = isInvestment ? 'block' : 'none';
            // Dynamically set the 'required' attribute to prevent validation errors on hidden fields.
            document.getElementById('invest-name').required = isInvestment;
            // Reset investment-specific form parts on switch
            document.getElementById('invest-name').value = '';
            document.getElementById('invest-name').disabled = false;
        });
    });

    // Ensure the date field has a value on load
    document.getElementById('trans-date').value = getCurrentDate();
}

/**
 * Helper to get CSS variable for JS (needed for color-coding)
 */
function varStyle(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Run initialization
window.onload = init;
