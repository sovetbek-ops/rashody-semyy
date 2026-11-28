"use strict";

(() => {
  const STORAGE_KEY = "family-expenses-v1";
  const BUDGET_KEY = "family-budgets-v1";
  const DAILY_KEY = "family-daily-budgets-v1";
  const SAVINGS_KEY = "family-savings-v1";
  const INCOME_KEY = "family-incomes-v1";
  const OBLIGATION_KEY = "family-obligations-v1";
  let categories = [];
  let daily = { version: 1, articles: [], expenses: [], legacyBudgets: {} };
  const categoryName = (id) => daily.articles.find((article) => article.id === id)?.name || "Статья недоступна";
  const byId = (id) => document.getElementById(id);
  const views = {
    overview: ["Обзор", "Расходы семьи за текущий месяц."],
    expenses: ["Траты", "Записывайте расходы и выбирайте период просмотра."],
    budget: ["Бюджет", "Планируйте расходы и следите за лимитами месяца."],
    savings: ["Накопления", "Деньги на цели учитываются отдельно от расходов"],
    incomes: ["Доходы", "Записывайте поступления семьи из любых источников."],
    obligations: ["Обязательные платежи", "Планируйте обязательные расходы семьи."]
  };

  function showView(view, focusAmount = false) {
    if (!views[view]) return;
    render();
    Object.keys(views).forEach((name) => { byId(`view-${name}`).hidden = name !== view; });
    document.querySelectorAll(".nav-button").forEach((button) => {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    byId("page-title").textContent = views[view][0];
    byId("page-description").textContent = views[view][1];
    (focusAmount ? byId("amount") : byId("page-title")).focus();
  }

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  document.querySelectorAll("[data-open-expense]").forEach((button) => {
    button.addEventListener("click", () => showView("expenses", true));
  });
  const form = byId("expense-form");
  const start = byId("period-start");
  const end = byId("period-end");
  let expenses = [];
  let storageReadable = false;
  let selectedExpense = null;
  let savedSnapshot = null;
  let activePeriod = "all";
  let budgetsReadable = false;
  let expenseWritePending = false;
  let editArticleId = null;
  let editArticleSnapshot = null;
  let editArticleConflict = false;
  let articleAction = null;
  let dateEdited = false;
  let renderedExpenses = [];
  let renderedSelection = null;
  let renderedStorageReadable = true;
  let renderedExpenseNames = "";
  let savings = { version: 1, goals: [] };
  let savingsReadable = true;
  let savingsWritePending = false;
  let renderedSavings = null;
  let renderedSavingsDay = "";
  let depositGoalId = null;
  let historyGoalId = null;
  let withdrawGoalId = null;
  let withdrawConfirmation = null;
  let withdrawNotice = "";
  let editGoalId = null;
  let editSnapshot = null;
  let editConflict = false;
  let deleteGoalId = null;
  let deleteSnapshot = null;
  let deleteConflict = false;
  let incomes = { version: 1, records: [] };
  let incomesReadable = true;
  let incomeWritePending = false;
  let renderedIncomes = null;
  let incomeActivePeriod = "all";
  let incomeDateEdited = false;
  const incomeStart = byId("income-period-start");
  const incomeEnd = byId("income-period-end");
  const incomeFields = ["income-name", "income-amount", "income-date", "income-comment"];
  const incomeEditFields = ["income-edit-name", "income-edit-amount", "income-edit-date", "income-edit-comment"];
  let incomeEditId = null;
  let incomeEditSnapshot = null;
  let incomeEditConflict = false;
  let incomeDeleteId = null;
  let incomeDeleteSnapshot = null;
  let incomeDeleteConflict = false;

  function renderIncomeDelete() {
    const record = incomesReadable ? incomes.records.find((item) => item.id === incomeDeleteId) : null;
    if (incomeDeleteId !== null && incomesReadable && (!record || JSON.stringify(record) !== incomeDeleteSnapshot)) {
      incomeDeleteConflict = true;
    }
    byId("confirm-income-delete").disabled = incomeWritePending || !incomesReadable || incomeDeleteConflict;
    byId("cancel-income-delete").disabled = incomeWritePending;
    byId("income-delete-state").textContent = incomeDeleteId === null ? "" : !incomesReadable
      ? "Доходы недоступны. Удаление приостановлено. Попробуйте обновить страницу."
      : incomeDeleteConflict ? record
        ? "Доход изменился. Откройте удаление заново и проверьте данные."
        : "Этот доход уже удалён. Повторное удаление недоступно."
      : "";
  }

  function closeIncomeDelete() {
    const id = incomeDeleteId;
    incomeDeleteId = null;
    incomeDeleteSnapshot = null;
    incomeDeleteConflict = false;
    byId("income-delete-editor").hidden = true;
    byId("income-delete-name").textContent = "";
    byId("income-delete-details").textContent = "";
    byId("income-delete-comment").textContent = "";
    renderIncomeDelete();
    return id;
  }

  function openIncomeDelete(id) {
    if (incomeWritePending) return;
    loadIncomes();
    renderIncomes();
    const record = incomesReadable ? incomes.records.find((item) => item.id === id) : null;
    if (!record) return;
    incomeDeleteId = id;
    incomeDeleteSnapshot = JSON.stringify(record);
    incomeDeleteConflict = false;
    byId("income-status").textContent = "";
    byId("income-delete-name").textContent = record.name;
    byId("income-delete-details").textContent = `${money(record.amount)} · ${displayDate(record.date)}`;
    byId("income-delete-comment").textContent = record.comment;
    byId("income-delete-comment").hidden = !record.comment;
    byId("income-delete-editor").hidden = false;
    renderIncomeDelete();
    byId("cancel-income-delete").focus();
  }

  byId("cancel-income-delete").addEventListener("click", () => {
    if (incomeWritePending || incomeDeleteId === null) return;
    const id = closeIncomeDelete();
    if (!byId("view-incomes").hidden) {
      (byId(`income-delete-${id}`) || byId("income-history-heading")).focus();
    }
  });
  byId("confirm-income-delete").addEventListener("click", async () => {
    if (incomeWritePending || incomeDeleteId === null || incomeDeleteConflict || !incomesReadable) return;
    const id = incomeDeleteId;
    byId("income-status").textContent = "";
    incomeWritePending = true;
    let removed = false;
    renderIncomes();
    try {
      const remove = () => {
        loadIncomes();
        renderIncomeDelete();
        if (!incomesReadable || incomeDeleteConflict) return;
        const next = { version: 1, records: incomes.records.filter((record) => record.id !== id) };
        localStorage.setItem(INCOME_KEY, JSON.stringify(next));
        incomes = next;
        closeIncomeDelete();
        if (incomeEditId === id) closeIncomeEdit();
        removed = true;
        byId("income-status").textContent = "Доход удалён";
      };
      if (navigator.locks?.request) await navigator.locks.request(INCOME_KEY, remove);
      else remove();
    } catch {
      incomeStorageError("Не удалось сохранить удаление дохода. Запись осталась в истории. Попробуйте снова.");
    } finally {
      incomeWritePending = false;
      renderIncomes();
      if (removed && !byId("view-incomes").hidden) byId("income-history-heading").focus();
    }
  });

  function renderIncomeEdit() {
    const record = incomesReadable ? incomes.records.find((item) => item.id === incomeEditId) : null;
    if (incomeEditId !== null && incomesReadable && (!record || JSON.stringify(record) !== incomeEditSnapshot)) {
      incomeEditConflict = true;
    }
    incomeEditFields.forEach((id) => { byId(id).disabled = incomeWritePending; });
    byId("save-income-edit").disabled = incomeWritePending || !incomesReadable || incomeEditConflict;
    byId("cancel-income-edit").disabled = incomeWritePending;
    byId("income-edit-state").textContent = incomeEditId === null ? "" : !incomesReadable
      ? "Доходы недоступны. Изменения приостановлены, введённые поля оставлены."
      : incomeEditConflict ? record
        ? "Доход изменился в другой вкладке. Откройте его заново и проверьте данные. Введённые поля оставлены."
        : "Доход удалён в другой вкладке. Введённые поля оставлены, сохранить их в эту запись нельзя."
      : "";
    const date = byId("income-edit-date").value;
    byId("income-edit-date-display").textContent = validDate(date) ? displayDate(date) : "";
  }

  function focusIncomeEditAction(id) {
    if (!byId("view-incomes").hidden) {
      (byId(`income-edit-${id}`) || byId("income-history-heading")).focus();
    }
  }

  function closeIncomeEdit() {
    const id = incomeEditId;
    incomeEditId = null;
    incomeEditSnapshot = null;
    incomeEditConflict = false;
    byId("income-edit-editor").hidden = true;
    byId("income-edit-form").reset();
    incomeEditFields.forEach((field) => fieldError(field, ""));
    renderIncomeEdit();
    return id;
  }

  function openIncomeEdit(id) {
    if (incomeWritePending) return;
    loadIncomes();
    renderIncomes();
    const record = incomesReadable ? incomes.records.find((item) => item.id === id) : null;
    if (!record) return;
    incomeEditId = id;
    incomeEditSnapshot = JSON.stringify(record);
    incomeEditConflict = false;
    byId("income-status").textContent = "";
    byId("income-edit-original").textContent = `${record.name} · ${money(record.amount)} · ${displayDate(record.date)}`;
    byId("income-edit-name").value = record.name;
    byId("income-edit-amount").value = String(record.amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    byId("income-edit-date").value = record.date;
    byId("income-edit-comment").value = record.comment;
    incomeEditFields.forEach((field) => fieldError(field, ""));
    byId("income-edit-editor").hidden = false;
    renderIncomeEdit();
    byId("income-edit-name").focus();
  }

  byId("income-edit-date").addEventListener("input", renderIncomeEdit);
  byId("cancel-income-edit").addEventListener("click", () => {
    if (incomeWritePending || incomeEditId === null) return;
    const id = closeIncomeEdit();
    focusIncomeEditAction(id);
  });
  byId("income-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (incomeWritePending || incomeEditId === null || incomeEditConflict || !incomesReadable) return;
    updateIncomeDates();
    byId("income-status").textContent = "";
    const name = byId("income-edit-name").value.trim();
    const amount = parseAmount(byId("income-edit-amount").value);
    const date = byId("income-edit-date").value;
    const comment = byId("income-edit-comment").value.trim();
    fieldError("income-edit-name", !name || Array.from(name).length > 100 ? "Введите название от 1 до 100 символов." : "");
    fieldError("income-edit-amount", amount === null ? "Введите положительную целую сумму до 9 007 199 254 740 991 ₸." : "");
    fieldError("income-edit-date", validDate(date) ? "" : "Укажите корректную дату.");
    fieldError("income-edit-comment", Array.from(comment).length > 1000 ? "Комментарий — не больше 1 000 символов." : "");
    const invalid = incomeEditFields.find((id) => byId(id).getAttribute("aria-invalid") === "true");
    if (invalid) { byId(invalid).focus(); return; }
    const id = incomeEditId;
    incomeWritePending = true;
    let saved = false;
    renderIncomes();
    try {
      const edit = () => {
        loadIncomes();
        renderIncomeEdit();
        if (!incomesReadable || incomeEditConflict) return;
        const next = { version: 1, records: incomes.records.map((record) =>
          record.id === id ? { ...record, name, amount, date, comment } : record) };
        localStorage.setItem(INCOME_KEY, JSON.stringify(next));
        incomes = next;
        closeIncomeEdit();
        saved = true;
        byId("income-status").textContent = "Доход изменён";
      };
      if (navigator.locks?.request) await navigator.locks.request(INCOME_KEY, edit);
      else edit();
    } catch {
      incomeStorageError("Не удалось сохранить изменения дохода. Введённые поля оставлены. Попробуйте снова.");
    } finally {
      incomeWritePending = false;
      renderIncomes();
      if (saved) focusIncomeEditAction(id);
    }
  });

  const obligationFrequencies = { once: "Один раз", monthly: "Каждый месяц", quarterly: "Каждые 3 месяца", yearly: "Каждый год" };
  const obligationFields = ["obligation-name", "obligation-amount", "obligation-date", "obligation-frequency"];
  let obligations = { version: 1, rules: [], payments: [] };
  let obligationsReadable = true;
  let obligationWritePending = false;
  let obligationDateEdited = false;
  let obligationConfirmation = null;
  let renderedObligations = "";
  let obligationPaymentAction = null;
  let obligationScheduleReady = true;

  function renderFamilyMoney() {
    const month = localDate().slice(0, 7);
    const income = incomesReadable ? total(incomes.records.filter((item) => item.date.startsWith(month))) : null;
    const spent = storageReadable ? total(expenses.filter((item) => item.date.startsWith(month))) : null;
    const paid = obligationsReadable ? total(obligations.payments.filter((item) => item.status === "paid" && item.paidDate.startsWith(month))) : null;
    const reserved = obligationsReadable && obligationScheduleReady ? total(obligations.payments.filter((item) => item.status === "unpaid")) : null;
    const available = [income, spent, paid, reserved].includes(null) ? null : income - spent - paid - reserved;
    const formatted = (amount) => amount === null ? "—" : amount < 0n ? `−${money(-amount)}` : money(amount);
    ["overview", "budget"].forEach((view) => {
      Object.entries({ income, expenses: spent, paid, reserved, available }).forEach(([name, amount]) => {
        byId(`${view}-family-${name}`).textContent = formatted(amount);
      });
      const warning = byId(`${view}-family-warning`);
      warning.textContent = available === null ? "Не удалось прочитать часть данных. Доступная сумма неизвестна." : available < 0n ? `Не хватает: ${money(-available)}` : "";
      warning.hidden = !warning.textContent;
    });
  }

  function obligationPaymentSnapshot(payment) {
    return JSON.stringify([payment, obligations.rules.find((rule) => rule.id === payment.ruleId)]);
  }

  function renderObligationPayment() {
    byId("obligation-payment-editor").hidden = !obligationPaymentAction;
    if (!obligationPaymentAction) return;
    const action = obligationPaymentAction;
    const payment = obligationsReadable ? obligations.payments.find((item) => item.id === action.id) : null;
    if (obligationsReadable && (!payment || obligationPaymentSnapshot(payment) !== action.snapshot)) action.stale = true;
    byId("obligation-payment-state").textContent = !obligationsReadable ? "Не удалось прочитать платежи. Действие приостановлено." : action.stale ? "Платёж изменён или удалён. Закройте подтверждение и откройте платёж заново." : "";
    byId("confirm-obligation-payment").disabled = obligationWritePending || !obligationsReadable || action.stale;
    byId("cancel-obligation-payment").disabled = obligationWritePending;
    byId("obligation-paid-date").disabled = obligationWritePending || action.cancel;
    byId("obligation-paid-date").max = localDate();
    const date = byId("obligation-paid-date").value;
    byId("obligation-paid-date-display").textContent = validDate(date) ? `Выбрано: ${displayDate(date)}` : "";
  }

  function openObligationPayment(id) {
    if (obligationWritePending) return;
    loadObligations();
    const payment = obligationsReadable ? obligations.payments.find((item) => item.id === id) : null;
    if (!payment) { renderObligations(); return; }
    const rule = obligations.rules.find((item) => item.id === payment.ruleId);
    const cancel = payment.status === "paid";
    obligationPaymentAction = { id, cancel, snapshot: obligationPaymentSnapshot(payment), stale: false };
    byId("obligation-payment-heading").textContent = cancel ? "Отменить оплату?" : "Оплатить платёж?";
    byId("obligation-payment-details").textContent = `${rule.name} — ${money(payment.amount)}. Срок: ${displayDate(payment.date)}.${cancel ? ` Оплачен: ${displayDate(payment.paidDate)}.` : ""}`;
    byId("obligation-payment-note").textContent = cancel ? "Сумма вернётся в резерв и будет исключена из обязательных оплат месяца фактической оплаты." : "Оплата учтётся в деньгах семьи. Повторно добавлять её в «Траты» не нужно.";
    byId("obligation-paid-date-field").hidden = cancel;
    byId("obligation-paid-date").value = localDate();
    fieldError("obligation-paid-date", "");
    byId("confirm-obligation-payment").textContent = cancel ? "Отменить оплату" : "Оплатить";
    byId("obligation-status").textContent = "";
    renderObligations();
    byId("cancel-obligation-payment").focus();
  }

  function focusObligationPayment(id) {
    if (!byId("view-obligations").hidden) (byId(`obligation-action-${id}`) || byId("obligation-list-heading")).focus();
  }

  byId("obligation-list-filter").addEventListener("change", renderObligations);
  byId("obligation-paid-date").addEventListener("input", renderObligationPayment);
  byId("cancel-obligation-payment").addEventListener("click", () => {
    if (obligationWritePending || !obligationPaymentAction) return;
    const id = obligationPaymentAction.id;
    obligationPaymentAction = null;
    renderObligations();
    focusObligationPayment(id);
  });
  byId("obligation-payment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (obligationWritePending || !obligationPaymentAction || obligationPaymentAction.stale || !obligationsReadable) return;
    const action = obligationPaymentAction;
    const date = byId("obligation-paid-date").value;
    fieldError("obligation-paid-date", !action.cancel && (!validDate(date) || date > localDate()) ? "Укажите существующую дату не позже сегодняшней." : "");
    if (byId("obligation-paid-date").getAttribute("aria-invalid") === "true") { byId("obligation-paid-date").focus(); return; }
    obligationWritePending = true;
    renderObligations();
    let saved = false;
    try {
      const change = () => {
        loadObligations();
        renderObligationPayment();
        if (!obligationsReadable || action.stale) return;
        if (!action.cancel && date > localDate()) {
          fieldError("obligation-paid-date", "Дата оплаты не должна быть в будущем.");
          return;
        }
        const updated = appendMissingObligationPayments(obligations);
        if (updated !== obligations) obligationScheduleReady = false;
        const next = { ...updated, payments: updated.payments.map((payment) => payment.id === action.id ? {
          ...payment, status: action.cancel ? "unpaid" : "paid", paidDate: action.cancel ? null : date, changeId: savingsId()
        } : payment) };
        localStorage.setItem(OBLIGATION_KEY, JSON.stringify(next));
        obligations = next;
        obligationScheduleReady = true;
        obligationPaymentAction = null;
        byId("obligation-status").textContent = action.cancel ? "Оплата отменена" : "Платёж оплачен";
        saved = true;
      };
      if (navigator.locks?.request) await navigator.locks.request(OBLIGATION_KEY, change);
      else change();
    } catch {
      obligationStorageError("Не удалось сохранить оплату. Данные не изменены, попробуйте снова.");
    } finally {
      obligationWritePending = false;
      renderObligations();
      if (saved) focusObligationPayment(action.id);
      else if (!byId("view-obligations").hidden) byId("cancel-obligation-payment").focus();
    }
  });

  function obligationStorageError(message) {
    byId("obligation-storage-error").textContent = message;
    byId("obligation-storage-error").hidden = !message;
  }

  function loadObligations() {
    try {
      const raw = localStorage.getItem(OBLIGATION_KEY);
      const saved = raw === null ? { version: 1, rules: [], payments: [] } : JSON.parse(raw);
      const ruleIds = new Set();
      const paymentIds = new Set();
      const occurrences = new Set();
      if (!saved || saved.version !== 1 || !Array.isArray(saved.rules) || !Array.isArray(saved.payments) ||
        !saved.rules.every((rule) => {
          if (!rule || typeof rule.id !== "string" || !rule.id || ruleIds.has(rule.id) ||
            typeof rule.name !== "string" || !rule.name.trim() || Array.from(rule.name).length > 100 ||
            !Number.isSafeInteger(rule.amount) || rule.amount <= 0 || !validDate(rule.date) ||
            !Object.hasOwn(obligationFrequencies, rule.frequency)) return false;
          ruleIds.add(rule.id);
          return true;
        }) || !saved.payments.every((payment) => {
          if (!payment || typeof payment.id !== "string" || !payment.id || paymentIds.has(payment.id) ||
            !ruleIds.has(payment.ruleId) || !validDate(payment.date) ||
            !Number.isSafeInteger(payment.amount) || payment.amount <= 0 ||
            !["unpaid", "paid"].includes(payment.status) ||
            (payment.status === "paid" ? !validDate(payment.paidDate) : payment.paidDate !== null)) return false;
          const occurrence = `${payment.ruleId}:${payment.date}`;
          if (occurrences.has(occurrence)) return false;
          occurrences.add(occurrence);
          paymentIds.add(payment.id);
          return true;
        })) throw new Error("Invalid obligation data");
      obligations = saved;
      obligationsReadable = true;
      obligationStorageError("");
    } catch {
      obligationsReadable = false;
      obligationStorageError("Не удалось прочитать обязательные платежи. Изменения приостановлены, чтобы не потерять данные. Попробуйте обновить страницу.");
    }
  }

  // Always derive each occurrence from the original day, including after February.
  function initialObligationDates(date, frequency, today) {
    const dates = [date];
    if (frequency === "once") return dates;
    const interval = { monthly: 1, quarterly: 3, yearly: 12 }[frequency];
    const [year, month, day] = date.split("-").map(Number);
    const firstMonth = year * 12 + month - 1;
    const [currentYear, currentMonth] = today.split("-").map(Number);
    const lastMonth = currentYear * 12 + currentMonth - 1;
    for (let target = firstMonth + interval; target <= lastMonth; target += interval) {
      const targetYear = Math.floor(target / 12);
      const targetMonth = target % 12 + 1;
      const leap = targetYear % 4 === 0 && (targetYear % 100 !== 0 || targetYear % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      dates.push(`${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, days[targetMonth - 1])).padStart(2, "0")}`);
    }
    return dates;
  }

  // Rebuild expected dates from the original rule; existing paid and unpaid
  // occurrences both occupy their dates, including after moving the clock back.
  function appendMissingObligationPayments(saved) {
    const today = localDate();
    const occurrences = new Set(saved.payments.map((payment) => `${payment.ruleId}:${payment.date}`));
    const ids = new Set([...saved.rules, ...saved.payments].map((item) => item.id));
    const added = [];
    saved.rules.forEach((rule) => {
      initialObligationDates(rule.date, rule.frequency, today).forEach((date) => {
        const key = `${rule.id}:${date}`;
        if (occurrences.has(key)) return;
        let id;
        do { id = savingsId(); } while (ids.has(id));
        ids.add(id);
        occurrences.add(key);
        added.push({ id, ruleId: rule.id, amount: rule.amount, date, status: "unpaid", paidDate: null });
      });
    });
    return added.length ? { ...saved, payments: [...saved.payments, ...added] } : saved;
  }

  async function synchronizeObligationSchedule() {
    if (obligationWritePending || !obligationsReadable) return;
    // Avoid rewriting storage or rebuilding controls when nothing is due.
    if (appendMissingObligationPayments(obligations) === obligations) {
      obligationScheduleReady = true;
      return;
    }
    obligationWritePending = true;
    obligationScheduleReady = false;
    renderObligations();
    try {
      const synchronize = () => {
        loadObligations();
        if (!obligationsReadable) return;
        const next = appendMissingObligationPayments(obligations);
        if (next !== obligations) localStorage.setItem(OBLIGATION_KEY, JSON.stringify(next));
        obligations = next;
        obligationScheduleReady = true;
      };
      if (navigator.locks?.request) await navigator.locks.request(OBLIGATION_KEY, synchronize);
      else synchronize();
    } catch {
      obligationStorageError("Не удалось создать платежи за новые месяцы. Резерв и доступная сумма пока неизвестны. Попробуйте обновить страницу.");
    } finally {
      obligationWritePending = false;
      renderObligations();
    }
  }

  function renderObligations() {
    renderFamilyMoney();
    renderObligationPayment();
    const today = localDate();
    if (!obligationDateEdited && !obligationConfirmation) byId("obligation-date").value = today;
    const date = byId("obligation-date").value;
    byId("obligation-date-display").textContent = validDate(date) ? `Выбрано: ${displayDate(date)}` : "";
    obligationFields.forEach((id) => { byId(id).disabled = obligationWritePending || Boolean(obligationConfirmation); });
    byId("preview-obligation").disabled = obligationWritePending || !obligationsReadable || Boolean(obligationConfirmation);
    byId("confirm-obligation").disabled = obligationWritePending || !obligationsReadable;
    byId("cancel-obligation").disabled = obligationWritePending;
    byId("obligation-confirmation").hidden = !obligationConfirmation;
    if (obligationConfirmation) {
      const pending = obligationConfirmation;
      byId("obligation-confirm-name").textContent = `${pending.name} — ${money(pending.amount)}`;
      byId("obligation-confirm-details").textContent = `${obligationFrequencies[pending.frequency]}. Сроки: ${displayDate(pending.dates[0])}${pending.dates.length > 1 ? ` — ${displayDate(pending.dates[pending.dates.length - 1])}` : ""}.`;
      byId("obligation-confirm-total").textContent = `Платежей: ${pending.dates.length}. Сумма для резерва: ${money(BigInt(pending.amount) * BigInt(pending.dates.length))}`;
    }
    const filter = byId("obligation-list-filter").value;
    const month = today.slice(0, 7);
    const payments = obligationsReadable ? obligations.payments.filter((payment) => filter === "all" || (filter === "paid" ? payment.status === "paid" :
      payment.status === "unpaid" || payment.date.startsWith(month) || payment.paidDate?.startsWith(month))).sort((a, b) =>
      Number(a.status === "paid") - Number(b.status === "paid") || a.date.localeCompare(b.date)) : [];
    byId("obligation-count").textContent = `Записей: ${obligationsReadable ? payments.length : "—"}`;
    byId("obligation-empty").textContent = !obligationsReadable ? "Не удалось прочитать платежи. Список недоступен." : !obligations.payments.length ? "Пока нет обязательных платежей" : "Нет платежей для этого списка";
    byId("obligation-empty").hidden = obligationsReadable && payments.length > 0;
    const signature = JSON.stringify([obligationsReadable, obligations, today, filter, obligationWritePending]);
    if (signature === renderedObligations) return;
    renderedObligations = signature;
    const fragment = document.createDocumentFragment();
    const rules = new Map(obligations.rules.map((rule) => [rule.id, rule]));
    payments.forEach((payment) => {
      const rule = rules.get(payment.ruleId);
      const item = document.createElement("li");
      item.className = "recent-expense";
      const name = document.createElement("strong");
      name.textContent = rule.name;
      const amount = document.createElement("strong");
      amount.className = "recent-amount";
      amount.textContent = money(payment.amount);
      const details = document.createElement("span");
      details.className = "recent-date";
      details.textContent = `Срок: ${displayDate(payment.date)} · ${obligationFrequencies[rule.frequency]}`;
      const status = document.createElement("p");
      status.className = "recent-comment";
      status.textContent = payment.status === "paid" ? `Оплачен: ${displayDate(payment.paidDate)}` : `Не оплачен${payment.date < today ? " · Просрочен" : ""}`;
      item.append(name, amount, details, status);
      const actions = document.createElement("div");
      actions.className = "goal-actions income-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.id = `obligation-action-${payment.id}`;
      button.textContent = payment.status === "paid" ? "Отменить оплату" : "Оплатить";
      button.setAttribute("aria-label", `${button.textContent}: ${rule.name}, ${money(payment.amount)}, срок ${displayDate(payment.date)}`);
      button.disabled = obligationWritePending;
      button.addEventListener("click", () => openObligationPayment(payment.id));
      actions.append(button);
      item.append(actions);
      fragment.append(item);
    });
    byId("obligation-list").replaceChildren(fragment);
  }

  byId("obligation-date").addEventListener("input", () => { obligationDateEdited = true; renderObligations(); });
  byId("obligation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (obligationWritePending || obligationConfirmation || !obligationsReadable) return;
    renderObligations();
    byId("obligation-status").textContent = "";
    const name = byId("obligation-name").value.trim();
    const amount = parseAmount(byId("obligation-amount").value);
    const date = byId("obligation-date").value;
    const frequency = byId("obligation-frequency").value;
    fieldError("obligation-name", !name || Array.from(name).length > 100 ? "Введите название от 1 до 100 символов." : "");
    fieldError("obligation-amount", amount === null ? "Введите положительную целую сумму до 9 007 199 254 740 991 ₸." : "");
    fieldError("obligation-date", validDate(date) ? "" : "Укажите корректную дату.");
    fieldError("obligation-frequency", Object.hasOwn(obligationFrequencies, frequency) ? "" : "Выберите периодичность.");
    const invalid = obligationFields.find((id) => byId(id).getAttribute("aria-invalid") === "true");
    if (invalid) { byId(invalid).focus(); return; }
    obligationConfirmation = { name, amount, date, frequency, month: localDate().slice(0, 7), dates: initialObligationDates(date, frequency, localDate()) };
    renderObligations();
    byId("cancel-obligation").focus();
  });
  byId("cancel-obligation").addEventListener("click", () => {
    if (obligationWritePending) return;
    obligationConfirmation = null;
    // Cancellation preserves the exact date the user reviewed, even across midnight.
    obligationDateEdited = true;
    renderObligations();
    byId("preview-obligation").focus();
  });
  byId("confirm-obligation").addEventListener("click", async () => {
    if (obligationWritePending || !obligationConfirmation || !obligationsReadable) return;
    const pending = obligationConfirmation;
    if (pending.month !== localDate().slice(0, 7)) {
      pending.month = localDate().slice(0, 7);
      pending.dates = initialObligationDates(pending.date, pending.frequency, localDate());
      renderObligations();
      obligationStorageError("Начался новый месяц. Проверьте число платежей и подтвердите создание заново.");
      byId("cancel-obligation").focus();
      return;
    }
    obligationWritePending = true;
    renderObligations();
    let saved = false;
    try {
      const create = () => {
        loadObligations();
        if (!obligationsReadable) return;
        // A lock can be acquired after midnight: never save an unreviewed count.
        if (pending.month !== localDate().slice(0, 7)) {
          obligationStorageError("Начался новый месяц. Проверьте число платежей и подтвердите создание заново.");
          return;
        }
        const updated = appendMissingObligationPayments(obligations);
        if (updated !== obligations) obligationScheduleReady = false;
        const ids = new Set([...updated.rules, ...updated.payments].map((item) => item.id));
        const uniqueId = () => {
          let id;
          do { id = savingsId(); } while (ids.has(id));
          ids.add(id);
          return id;
        };
        const rule = { id: uniqueId(), name: pending.name, amount: pending.amount, date: pending.date, frequency: pending.frequency };
        const payments = pending.dates.map((date) => ({ id: uniqueId(), ruleId: rule.id, amount: rule.amount, date, status: "unpaid", paidDate: null }));
        const next = { version: 1, rules: [...updated.rules, rule], payments: [...updated.payments, ...payments] };
        localStorage.setItem(OBLIGATION_KEY, JSON.stringify(next));
        obligations = next;
        obligationScheduleReady = true;
        obligationConfirmation = null;
        byId("obligation-form").reset();
        obligationDateEdited = false;
        byId("obligation-status").textContent = `Платежи созданы: ${payments.length}`;
        saved = true;
      };
      if (navigator.locks?.request) await navigator.locks.request(OBLIGATION_KEY, create);
      else create();
    } catch {
      obligationStorageError("Не удалось сохранить обязательные платежи. Введённые данные оставлены. Попробуйте снова.");
    } finally {
      obligationWritePending = false;
      renderObligations();
      if (!byId("view-obligations").hidden) byId(saved ? "obligation-name" : "cancel-obligation").focus();
    }
  });

  function incomeStorageError(message) {
    byId("income-storage-error").textContent = message;
    byId("income-storage-error").hidden = !message;
  }

  function loadIncomes() {
    try {
      const raw = localStorage.getItem(INCOME_KEY);
      const saved = raw === null ? { version: 1, records: [] } : JSON.parse(raw);
      const ids = new Set();
      if (!saved || saved.version !== 1 || !Array.isArray(saved.records) || !saved.records.every((record) => {
        if (!record || typeof record.id !== "string" || !record.id || ids.has(record.id) ||
          typeof record.name !== "string" || !record.name.trim() || Array.from(record.name).length > 100 ||
          !Number.isSafeInteger(record.amount) || record.amount <= 0 || !validDate(record.date) ||
          typeof record.comment !== "string" || Array.from(record.comment).length > 1000) return false;
        ids.add(record.id);
        return true;
      })) throw new Error("Invalid income data");
      if (!incomesReadable || JSON.stringify(saved) !== JSON.stringify(incomes)) incomes = saved;
      incomesReadable = true;
      incomeStorageError("");
    } catch {
      incomesReadable = false;
      incomeStorageError("Не удалось прочитать доходы. Изменения приостановлены, чтобы не потерять данные. Попробуйте обновить страницу.");
    }
  }

  function markIncomePeriod(period) {
    incomeActivePeriod = period;
    document.querySelectorAll("[data-income-period]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.incomePeriod === period));
    });
  }

  function updateIncomeDates() {
    const now = new Date();
    if (!incomeDateEdited) byId("income-date").value = localDate(now);
    if (!incomeActivePeriod || incomeActivePeriod === "all") return;
    const first = new Date(now);
    let last = localDate(now);
    if (incomeActivePeriod === "month") {
      first.setDate(1);
      last = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    } else {
      first.setDate(first.getDate() - Number(incomeActivePeriod) + 1);
    }
    incomeStart.value = localDate(first);
    incomeEnd.value = last;
  }

  function renderIncomes() {
    renderFamilyMoney();
    updateIncomeDates();
    renderIncomeEdit();
    renderIncomeDelete();
    document.querySelectorAll("[data-income-edit]").forEach((button) => {
      button.disabled = incomeWritePending || !incomesReadable;
    });
    document.querySelectorAll("[data-income-delete]").forEach((button) => {
      button.disabled = incomeWritePending || !incomesReadable;
    });
    incomeFields.forEach((id) => { byId(id).disabled = incomeWritePending; });
    byId("add-income").disabled = incomeWritePending || !incomesReadable;
    const date = byId("income-date").value;
    byId("income-date-display").textContent = validDate(date) ? displayDate(date) : "";
    const invalidPeriod = Boolean((incomeStart.value && !validDate(incomeStart.value)) ||
      (incomeEnd.value && !validDate(incomeEnd.value)) ||
      (incomeStart.value && incomeEnd.value && incomeStart.value > incomeEnd.value));
    byId("income-period-error").textContent = invalidPeriod ? "Проверьте период: дата «С» должна быть не позже даты «По»." : "";
    byId("income-period-error").hidden = !invalidPeriod;
    [incomeStart, incomeEnd].forEach((input) => input.setAttribute("aria-invalid", String(invalidPeriod)));
    byId("income-period-display").textContent = invalidPeriod ? "" : [
      incomeStart.value ? `С ${displayDate(incomeStart.value)}` : "",
      incomeEnd.value ? `По ${displayDate(incomeEnd.value)}` : ""
    ].filter(Boolean).join(" · ") || "Все даты";
    const available = incomesReadable && !invalidPeriod;
    const visible = available ? incomes.records.filter((record) =>
      (!incomeStart.value || record.date >= incomeStart.value) && (!incomeEnd.value || record.date <= incomeEnd.value)) : [];
    byId("income-total").textContent = available ? money(total(visible)) : "—";
    byId("income-count").textContent = `Записей: ${available ? visible.length : "—"}`;
    byId("income-empty").hidden = !available || visible.length > 0;
    byId("income-empty").textContent = incomes.records.length ? "За этот период доходов нет" : "Пока нет доходов";
    const snapshot = available ? JSON.stringify(visible) : null;
    if (renderedIncomes === snapshot) return;
    renderedIncomes = snapshot;
    const fragment = document.createDocumentFragment();
    visible.forEach((record) => {
      const row = document.createElement("li");
      row.className = "recent-expense";
      const name = document.createElement("strong");
      name.textContent = record.name;
      const amount = document.createElement("strong");
      amount.className = "recent-amount";
      amount.textContent = money(record.amount);
      const date = document.createElement("time");
      date.className = "recent-date";
      date.dateTime = record.date;
      date.textContent = displayDate(record.date);
      row.append(name, amount, date);
      if (record.comment) {
        const comment = document.createElement("p");
        comment.className = "recent-comment";
        comment.textContent = record.comment;
        row.append(comment);
      }
      const actions = document.createElement("div");
      actions.className = "goal-actions income-actions";
      const edit = document.createElement("button");
      edit.id = `income-edit-${record.id}`;
      edit.type = "button";
      edit.textContent = "Изменить";
      edit.setAttribute("data-income-edit", record.id);
      edit.setAttribute("aria-controls", "income-edit-editor");
      edit.setAttribute("aria-label", `Изменить доход: ${record.name}, ${money(record.amount)}, ${displayDate(record.date)}`);
      edit.disabled = incomeWritePending;
      edit.addEventListener("click", () => openIncomeEdit(record.id));
      actions.append(edit);
      const remove = document.createElement("button");
      remove.id = `income-delete-${record.id}`;
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Удалить";
      remove.setAttribute("data-income-delete", record.id);
      remove.setAttribute("aria-controls", "income-delete-editor");
      remove.setAttribute("aria-label", `Удалить доход: ${record.name}, ${money(record.amount)}, ${displayDate(record.date)}`);
      remove.disabled = incomeWritePending;
      remove.addEventListener("click", () => openIncomeDelete(record.id));
      actions.append(remove);
      row.append(actions);
      fragment.append(row);
    });
    byId("income-list").replaceChildren(fragment);
  }

  document.querySelectorAll("[data-income-period]").forEach((button) => {
    button.addEventListener("click", () => {
      markIncomePeriod(button.dataset.incomePeriod);
      if (incomeActivePeriod === "all") { incomeStart.value = ""; incomeEnd.value = ""; }
      renderIncomes();
    });
  });
  [incomeStart, incomeEnd].forEach((input) => input.addEventListener("input", () => {
    markIncomePeriod("");
    renderIncomes();
  }));
  byId("income-date").addEventListener("input", () => { incomeDateEdited = true; renderIncomes(); });
  byId("income-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (incomeWritePending || !incomesReadable) return;
    updateIncomeDates();
    byId("income-status").textContent = "";
    const name = byId("income-name").value.trim();
    const amount = parseAmount(byId("income-amount").value);
    const date = byId("income-date").value;
    const comment = byId("income-comment").value.trim();
    fieldError("income-name", !name || Array.from(name).length > 100 ? "Введите название от 1 до 100 символов." : "");
    fieldError("income-amount", amount === null ? "Введите положительную целую сумму до 9 007 199 254 740 991 ₸." : "");
    fieldError("income-date", validDate(date) ? "" : "Укажите корректную дату.");
    fieldError("income-comment", Array.from(comment).length > 1000 ? "Комментарий — не больше 1 000 символов." : "");
    const invalid = incomeFields.find((id) => byId(id).getAttribute("aria-invalid") === "true");
    if (invalid) { byId(invalid).focus(); return; }
    incomeWritePending = true;
    renderIncomes();
    try {
      const add = () => {
        loadIncomes();
        if (!incomesReadable) return;
        let id;
        do { id = savingsId(); } while (incomes.records.some((record) => record.id === id));
        const next = { version: 1, records: [{ id, name, amount, date, comment }, ...incomes.records] };
        try {
          localStorage.setItem(INCOME_KEY, JSON.stringify(next));
        } catch {
          incomeStorageError("Не удалось сохранить доход. Введённые поля оставлены. Попробуйте снова.");
          return;
        }
        incomes = next;
        byId("income-form").reset();
        incomeDateEdited = false;
        byId("income-date").value = localDate();
        byId("income-status").textContent = "Доход добавлен";
      };
      if (navigator.locks?.request) await navigator.locks.request(INCOME_KEY, add);
      else add();
    } catch {
      incomeStorageError("Не удалось обновить доходы. Введённые поля оставлены. Попробуйте снова.");
    } finally {
      incomeWritePending = false;
      renderIncomes();
      if (byId("income-status").textContent && !byId("view-incomes").hidden) byId("income-name").focus();
    }
  });

  function savingsError(message) {
    byId("savings-error").textContent = message;
    byId("savings-error").hidden = !message;
  }

  function loadSavings() {
    try {
      const raw = localStorage.getItem(SAVINGS_KEY);
      const saved = raw === null ? { version: 1, goals: [] } : JSON.parse(raw);
      const ids = new Set();
      const uniqueId = (id) => {
        if (typeof id !== "string" || !id || ids.has(id)) return false;
        ids.add(id);
        return true;
      };
      if (!saved || saved.version !== 1 || !Array.isArray(saved.goals) || !saved.goals.every((goal) =>
        goal && uniqueId(goal.id) && typeof goal.name === "string" && goal.name.trim().length > 0 &&
        Array.from(goal.name).length <= 100 && typeof goal.description === "string" &&
        Array.from(goal.description).length <= 1000 && Number.isSafeInteger(goal.target) && goal.target > 0 &&
        validDate(goal.date) && Array.isArray(goal.operations) &&
        validSavingsOperations(goal.operations, uniqueId)
      )) throw new Error("Invalid savings data");
      // Preserve the rendered cards and focus when the stored document is unchanged.
      if (!savingsReadable || JSON.stringify(savings) !== JSON.stringify(saved)) savings = saved;
      savingsReadable = true;
      savingsError("");
    } catch {
      savingsReadable = false;
      savingsError("Не удалось прочитать накопления. Изменения приостановлены, чтобы не потерять данные. Попробуйте обновить страницу.");
    }
  }

  function validSavingsOperations(operations, uniqueId) {
    let balance = 0n;
    return operations.every((operation, index) => {
      if (!operation || !uniqueId(operation.id) ||
        !["initial", "deposit", "withdraw"].includes(operation.type) ||
        (operation.type === "initial" && index !== 0) ||
        !Number.isSafeInteger(operation.amount) || operation.amount <= 0 || !validDate(operation.date)) return false;
      balance += operation.type === "withdraw" ? -BigInt(operation.amount) : BigInt(operation.amount);
      return operation.type !== "withdraw" || balance >= 0n || operation.confirmedNegative === true;
    });
  }

  function renderSavings(now) {
    goalFields.forEach((id) => { byId(id).disabled = savingsWritePending; });
    byId("create-goal").disabled = !savingsReadable || savingsWritePending;
    byId("save-goal").disabled = !savingsReadable || savingsWritePending;
    byId("cancel-goal").disabled = savingsWritePending;
    byId("deposit-amount").disabled = savingsWritePending;
    byId("cancel-deposit").disabled = savingsWritePending;
    byId("cancel-withdraw").disabled = savingsWritePending;
    byId("confirm-withdraw").disabled = savingsWritePending;
    byId("cancel-withdraw-confirm").disabled = savingsWritePending;
    editFields.forEach((id) => { byId(id).disabled = savingsWritePending; });
    byId("cancel-edit").disabled = savingsWritePending;
    byId("cancel-delete-goal").disabled = savingsWritePending;
    document.querySelectorAll("[data-savings-action]").forEach((button) => { button.disabled = savingsWritePending || !savingsReadable; });
    renderSavingsDetails();
    const state = byId("goals-state");
    state.hidden = savingsReadable && savings.goals.length > 0;
    state.textContent = savingsReadable ? "Пока нет целей" : "Накопления недоступны: —";
    const today = localDate(now);
    const snapshot = savingsReadable ? savings : null;
    if (renderedSavings === snapshot && renderedSavingsDay === today) return;
    renderedSavings = snapshot;
    renderedSavingsDay = today;
    const fragment = document.createDocumentFragment();
    if (savingsReadable) savings.goals.forEach((goal) => {
      const balance = goalBalance(goal);
      const target = BigInt(goal.target);
      const remaining = balance >= target ? 0n : target - balance;
      const tenths = balance <= 0n ? 0n : balance >= target ? 1000n : balance * 1000n / target;
      const percent = `${tenths / 10n}${tenths % 10n ? `,${tenths % 10n}` : ""}%`;
      const card = document.createElement("article");
      card.className = "card goal-card";
      const heading = document.createElement("h3");
      heading.id = `goal-${goal.id}`;
      heading.textContent = goal.name;
      card.setAttribute("aria-labelledby", heading.id);
      card.append(heading);
      if (goal.description) {
        const description = document.createElement("p");
        description.className = "goal-description";
        description.textContent = goal.description;
        card.append(description);
      }
      const values = document.createElement("dl");
      values.className = "goal-values";
      [["Целевая сумма", target], ["Накоплено", balance], ["Осталось", remaining]].forEach(([label, amount]) => {
        const pair = document.createElement("div");
        const name = document.createElement("dt");
        name.textContent = label;
        const value = document.createElement("dd");
        value.textContent = savingsMoney(amount);
        pair.append(name, value);
        values.append(pair);
      });
      const progress = document.createElement("p");
      progress.className = "goal-progress";
      progress.textContent = `Выполнено: ${percent}`;
      const track = document.createElement("div");
      track.className = "budget-track";
      track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("div");
      fill.className = "budget-fill";
      fill.style.width = `${Number(tenths) / 10}%`;
      track.append(fill);
      const deadline = document.createElement("p");
      deadline.className = "goal-deadline";
      deadline.append("Желаемая дата: ");
      const time = document.createElement("time");
      time.dateTime = goal.date;
      time.textContent = displayDate(goal.date);
      deadline.append(time);
      const status = document.createElement("p");
      status.className = "goal-state";
      status.textContent = balance >= target ? "Цель достигнута" : goal.date < today ? "Срок прошёл" : "Копим на цель";
      card.append(values, progress, track, deadline, status);
      if (balance > target) {
        const excess = document.createElement("p");
        excess.textContent = `Сверх цели: ${money(balance - target)}`;
        card.append(excess);
      }
      if (balance < 0n) {
        const negative = document.createElement("p");
        negative.className = "goal-negative";
        negative.textContent = `Отрицательный остаток: ${money(-balance)}`;
        card.append(negative);
      }
      const actions = document.createElement("div");
      actions.className = "goal-actions";
      [["deposit", "Пополнить"], ["withdraw", "Снять"], ["history", "История"], ["edit", "Изменить"], ["delete", "Удалить"]].forEach(([action, label]) => {
        const button = document.createElement("button");
        button.id = `${action}-${goal.id}`;
        button.type = "button";
        button.textContent = label;
        button.setAttribute("data-savings-action", action);
        button.setAttribute("aria-controls", action === "history" ? "goal-history" : `${action}-editor`);
        button.setAttribute("aria-label", `${label}: ${goal.name}`);
        button.disabled = savingsWritePending;
        if (action === "delete") button.className = "danger";
        button.addEventListener("click", () => {
          if (!savingsReadable || savingsWritePending) return;
          renderSavings(new Date());
          byId("goal-status").textContent = "";
          if (action === "deposit") {
            if (depositGoalId !== goal.id) {
              byId("deposit-form").reset();
              fieldError("deposit-amount", "");
            }
            depositGoalId = goal.id;
            byId("deposit-editor").hidden = false;
            renderSavingsDetails();
            byId("deposit-amount").focus();
          } else if (action === "withdraw") {
            if (withdrawGoalId !== goal.id) {
              byId("withdraw-form").reset();
              fieldError("withdraw-amount", "");
              withdrawConfirmation = null;
              withdrawNotice = "";
            }
            withdrawGoalId = goal.id;
            byId("withdraw-editor").hidden = false;
            renderSavingsDetails();
            (withdrawConfirmation ? byId("cancel-withdraw-confirm") : byId("withdraw-amount")).focus();
          } else if (action === "edit" || action === "delete") {
            openGoalManagement(action, goal.id);
          } else {
            historyGoalId = goal.id;
            byId("goal-history").hidden = false;
            renderSavingsDetails();
            byId("history-heading").focus();
          }
        });
        actions.append(button);
      });
      card.append(actions);
      fragment.append(card);
    });
    byId("goal-list").replaceChildren(fragment);
  }

  const goalFields = ["goal-name", "goal-description", "goal-target", "goal-initial", "goal-date"];
  const editFields = ["edit-name", "edit-description", "edit-target", "edit-date"];
  function renderGoalManagement() {
    const edited = savingsReadable ? savings.goals.find((goal) => goal.id === editGoalId) : null;
    if (editGoalId !== null) {
      if (savingsReadable && (!edited || JSON.stringify(edited) !== editSnapshot)) editConflict = true;
      byId("edit-balance").textContent = edited ? savingsMoney(goalBalance(edited)) : "—";
      byId("edit-state").textContent = !savingsReadable ? "Не удалось прочитать накопления. Сохранение приостановлено." : !edited
        ? "Цель удалена. Изменения не сохранены."
        : editConflict ? "Цель изменилась в другой вкладке. Проверьте данные заново: откройте «Изменить» у актуальной цели." : "";
    }
    byId("save-edit").disabled = savingsWritePending || !edited || editConflict;
    const deleted = savingsReadable ? savings.goals.find((goal) => goal.id === deleteGoalId) : null;
    if (deleteGoalId !== null) {
      if (savingsReadable && (!deleted || JSON.stringify(deleted) !== deleteSnapshot)) deleteConflict = true;
      byId("delete-goal-name").textContent = deleted ? deleted.name : "Цель недоступна";
      byId("delete-goal-target").textContent = deleted ? money(deleted.target) : "—";
      byId("delete-goal-balance").textContent = deleted ? savingsMoney(goalBalance(deleted)) : "—";
      byId("delete-goal-state").textContent = !savingsReadable ? "Не удалось прочитать накопления. Удаление приостановлено." : !deleted
        ? "Цель уже удалена."
        : deleteConflict ? "Цель изменилась в другой вкладке. Проверьте данные заново: откройте «Удалить» у актуальной цели." : "";
    }
    byId("confirm-delete-goal").disabled = savingsWritePending || !deleted || deleteConflict;
  }

  function openGoalManagement(action, id) {
    loadSavings();
    renderSavings(new Date());
    const goal = savingsReadable ? savings.goals.find((item) => item.id === id) : null;
    if (!goal) {
      if (savingsReadable) savingsError("Цель уже удалена. Выберите другую цель.");
      return;
    }
    if (action === "edit") {
      editGoalId = id;
      editSnapshot = JSON.stringify(goal);
      editConflict = false;
      editFields.forEach((field) => fieldError(field, ""));
      byId("edit-name").value = goal.name;
      byId("edit-description").value = goal.description;
      byId("edit-target").value = String(goal.target).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      byId("edit-date").value = goal.date;
      byId("edit-date-preview").textContent = displayDate(goal.date);
      byId("edit-editor").hidden = false;
    } else {
      deleteGoalId = id;
      deleteSnapshot = JSON.stringify(goal);
      deleteConflict = false;
      byId("delete-editor").hidden = false;
    }
    renderGoalManagement();
    (action === "edit" ? byId("edit-name") : byId("cancel-delete-goal")).focus();
  }

  function closeGoalEdit() {
    const id = editGoalId;
    editGoalId = null;
    editSnapshot = null;
    editConflict = false;
    byId("edit-editor").hidden = true;
    byId("edit-form").reset();
    editFields.forEach((field) => fieldError(field, ""));
    byId("edit-date-preview").textContent = "";
    return id;
  }

  function closeGoalDelete() {
    const id = deleteGoalId;
    deleteGoalId = null;
    deleteSnapshot = null;
    deleteConflict = false;
    byId("delete-editor").hidden = true;
    return id;
  }

  byId("edit-date").addEventListener("input", () => {
    const value = byId("edit-date").value;
    byId("edit-date-preview").textContent = validDate(value) ? displayDate(value) : "";
  });
  byId("cancel-edit").addEventListener("click", () => {
    if (!savingsWritePending) focusGoalAction("edit", closeGoalEdit());
  });
  byId("cancel-delete-goal").addEventListener("click", () => {
    if (!savingsWritePending) focusGoalAction("delete", closeGoalDelete());
  });
  byId("edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (savingsWritePending || editGoalId === null || editConflict) return;
    byId("goal-status").textContent = "";
    const name = byId("edit-name").value.trim();
    const description = byId("edit-description").value.trim();
    const target = parseAmount(byId("edit-target").value);
    const date = byId("edit-date").value;
    fieldError("edit-name", !name || Array.from(name).length > 100 ? "Введите название от 1 до 100 символов." : "");
    fieldError("edit-description", Array.from(description).length > 1000 ? "Описание — не больше 1 000 символов." : "");
    fieldError("edit-target", target === null ? "Введите целую сумму от 1 до 9 007 199 254 740 991 ₸." : "");
    fieldError("edit-date", !validDate(date) ? "Укажите корректную желаемую дату." : "");
    const invalid = byId("edit-form").querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    const id = editGoalId;
    let saved = false;
    savingsWritePending = true;
    renderSavings(new Date());
    try {
      const edit = () => {
        loadSavings();
        renderGoalManagement();
        if (!savingsReadable || editConflict) return;
        const next = { ...savings, goals: savings.goals.map((goal) => goal.id === id ? { ...goal, name, description, target, date } : goal) };
        localStorage.setItem(SAVINGS_KEY, JSON.stringify(next));
        savings = next;
        saved = true;
        closeGoalEdit();
        byId("goal-status").textContent = "Цель изменена";
      };
      if (navigator.locks?.request) await navigator.locks.request(SAVINGS_KEY, edit);
      else edit();
    } catch {
      savingsError("Не удалось сохранить изменения цели. Введённые поля оставлены, попробуйте снова.");
    } finally {
      savingsWritePending = false;
      renderSavings(new Date());
      if (saved) focusGoalAction("edit", id);
    }
  });
  byId("confirm-delete-goal").addEventListener("click", async () => {
    if (savingsWritePending || deleteGoalId === null || deleteConflict) return;
    byId("goal-status").textContent = "";
    const id = deleteGoalId;
    let saved = false;
    savingsWritePending = true;
    renderSavings(new Date());
    try {
      const remove = () => {
        loadSavings();
        renderGoalManagement();
        if (!savingsReadable || deleteConflict) return;
        const next = { ...savings, goals: savings.goals.filter((goal) => goal.id !== id) };
        localStorage.setItem(SAVINGS_KEY, JSON.stringify(next));
        savings = next;
        saved = true;
        closeGoalDelete();
        if (editGoalId === id) closeGoalEdit();
        if (depositGoalId === id) closeDeposit();
        if (withdrawGoalId === id) closeWithdrawal();
        if (historyGoalId === id) {
          historyGoalId = null;
          byId("goal-history").hidden = true;
          byId("history-list").replaceChildren();
        }
        byId("goal-status").textContent = "Цель и история удалены";
      };
      if (navigator.locks?.request) await navigator.locks.request(SAVINGS_KEY, remove);
      else remove();
    } catch {
      savingsError("Не удалось сохранить удаление. Цель и её история остались, попробуйте снова.");
    } finally {
      savingsWritePending = false;
      renderSavings(new Date());
      if (saved) byId("savings-heading").focus();
    }
  });

  function savingsId() {
    return Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16).padStart(8, "0")).join("");
  }

  function goalBalance(goal) {
    return goal.operations.reduce((sum, operation) => sum + (operation.type === "withdraw" ? -BigInt(operation.amount) : BigInt(operation.amount)), 0n);
  }

  function savingsMoney(value) {
    return value < 0n ? `−${money(-value)}` : money(value);
  }

  function focusGoalAction(action, id) {
    (byId(`${action}-${id}`) || byId("savings-heading")).focus();
  }

  function closeDeposit() {
    const id = depositGoalId;
    depositGoalId = null;
    byId("deposit-editor").hidden = true;
    byId("deposit-form").reset();
    fieldError("deposit-amount", "");
    return id;
  }

  function renderSavingsDetails() {
    const depositGoal = savingsReadable ? savings.goals.find((goal) => goal.id === depositGoalId) : null;
    byId("save-deposit").disabled = savingsWritePending || !depositGoal;
    if (depositGoalId !== null) {
      const amount = parseAmount(byId("deposit-amount").value);
      byId("deposit-goal-name").textContent = depositGoal ? depositGoal.name : "Цель недоступна";
      byId("deposit-current").textContent = depositGoal ? savingsMoney(goalBalance(depositGoal)) : "—";
      byId("deposit-next").textContent = depositGoal && amount !== null ? savingsMoney(goalBalance(depositGoal) + BigInt(amount)) : "—";
      byId("deposit-state").textContent = !savingsReadable ? "Не удалось прочитать накопления. Пополнение приостановлено." : !depositGoal ? "Цель удалена в другой вкладке. Пополнение не сохранено." : "";
    }
    renderWithdrawal();
    renderGoalManagement();
    if (historyGoalId !== null) {
      const goal = savingsReadable ? savings.goals.find((item) => item.id === historyGoalId) : null;
      byId("history-goal-name").textContent = goal ? goal.name : "Цель недоступна";
      const state = byId("history-state");
      state.hidden = Boolean(goal && goal.operations.length);
      state.textContent = !savingsReadable ? "Не удалось прочитать историю: —" : !goal ? "Цель удалена в другой вкладке" : "Операций пока нет";
      const fragment = document.createDocumentFragment();
      let balance = 0n;
      const rows = goal ? goal.operations.map((operation) => {
        balance += operation.type === "withdraw" ? -BigInt(operation.amount) : BigInt(operation.amount);
        const row = document.createElement("li");
        row.className = "history-entry";
        const date = document.createElement("time");
        date.dateTime = operation.date;
        date.textContent = displayDate(operation.date);
        const amount = document.createElement("p");
        amount.textContent = `${operation.type === "initial" ? "Начальная сумма" : operation.type === "withdraw" ? "Снятие" : "Пополнение"}: ${operation.type === "withdraw" ? "−" : "+"}${money(operation.amount)}`;
        const remaining = document.createElement("p");
        remaining.textContent = `Остаток: ${savingsMoney(balance)}`;
        row.append(date, amount, remaining);
        if (operation.type === "withdraw" && operation.confirmedNegative === true) {
          const confirmation = document.createElement("p");
          confirmation.className = "goal-negative";
          confirmation.textContent = "Снятие в минус подтверждено";
          row.append(confirmation);
        }
        return row;
      }) : [];
      rows.reverse().forEach((row) => fragment.append(row));
      byId("history-list").replaceChildren(fragment);
    }
  }

  byId("deposit-amount").addEventListener("input", renderSavingsDetails);
  byId("cancel-deposit").addEventListener("click", () => {
    if (!savingsWritePending) focusGoalAction("deposit", closeDeposit());
  });
  byId("close-history").addEventListener("click", () => {
    const id = historyGoalId;
    historyGoalId = null;
    byId("goal-history").hidden = true;
    focusGoalAction("history", id);
  });
  byId("deposit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (savingsWritePending || depositGoalId === null) return;
    byId("goal-status").textContent = "";
    const amount = parseAmount(byId("deposit-amount").value);
    fieldError("deposit-amount", amount === null ? "Введите целую сумму от 1 до 9 007 199 254 740 991 ₸." : "");
    if (amount === null) { byId("deposit-amount").focus(); return; }
    const id = depositGoalId;
    let saved = false;
    savingsWritePending = true;
    renderSavings(new Date());
    try {
      const deposit = () => {
        loadSavings();
        if (!savingsReadable || !savings.goals.some((goal) => goal.id === id)) return;
        const operation = { id: savingsId(), type: "deposit", amount, date: localDate() };
        const next = { ...savings, goals: savings.goals.map((goal) => goal.id === id ? { ...goal, operations: [...goal.operations, operation] } : goal) };
        localStorage.setItem(SAVINGS_KEY, JSON.stringify(next));
        savings = next;
        saved = true;
        closeDeposit();
        byId("goal-status").textContent = "Пополнение сохранено";
      };
      if (navigator.locks?.request) await navigator.locks.request(SAVINGS_KEY, deposit);
      else deposit();
    } catch {
      savingsError("Не удалось сохранить пополнение. Введённая сумма оставлена, попробуйте снова.");
    } finally {
      savingsWritePending = false;
      renderSavings(new Date());
      if (saved) focusGoalAction("deposit", id);
    }
  });
  function renderWithdrawal() {
    const goal = savingsReadable ? savings.goals.find((item) => item.id === withdrawGoalId) : null;
    const amount = parseAmount(byId("withdraw-amount").value);
    if (withdrawConfirmation && (!goal || JSON.stringify(goal) !== withdrawConfirmation.goal || amount !== withdrawConfirmation.amount)) {
      withdrawConfirmation = null;
      withdrawNotice = "Данные изменились. Проверьте результат и нажмите «Снять» заново.";
    }
    byId("withdraw-confirmation").hidden = !withdrawConfirmation;
    byId("withdraw-amount").disabled = savingsWritePending || Boolean(withdrawConfirmation);
    byId("save-withdraw").disabled = savingsWritePending || !goal || Boolean(withdrawConfirmation);
    if (withdrawGoalId === null) return;
    byId("withdraw-goal-name").textContent = goal ? goal.name : "Цель недоступна";
    byId("withdraw-current").textContent = goal ? savingsMoney(goalBalance(goal)) : "—";
    byId("withdraw-next").textContent = goal && amount !== null ? savingsMoney(goalBalance(goal) - BigInt(amount)) : "—";
    byId("withdraw-state").textContent = !savingsReadable ? "Не удалось прочитать накопления. Снятие приостановлено." : !goal ? "Цель удалена в другой вкладке. Снятие не сохранено." : withdrawNotice;
    if (withdrawConfirmation) {
      byId("withdraw-confirm-name").textContent = goal.name;
      byId("withdraw-confirm-amount").textContent = money(amount);
      byId("withdraw-confirm-current").textContent = savingsMoney(goalBalance(goal));
      byId("withdraw-confirm-next").textContent = savingsMoney(goalBalance(goal) - BigInt(amount));
    }
  }

  function closeWithdrawal() {
    const id = withdrawGoalId;
    withdrawGoalId = null;
    withdrawConfirmation = null;
    withdrawNotice = "";
    byId("withdraw-editor").hidden = true;
    byId("withdraw-confirmation").hidden = true;
    byId("withdraw-form").reset();
    fieldError("withdraw-amount", "");
    return id;
  }

  byId("withdraw-amount").addEventListener("input", () => {
    withdrawNotice = "";
    renderWithdrawal();
  });
  byId("cancel-withdraw").addEventListener("click", () => {
    if (!savingsWritePending) focusGoalAction("withdraw", closeWithdrawal());
  });
  byId("cancel-withdraw-confirm").addEventListener("click", () => {
    if (savingsWritePending) return;
    withdrawConfirmation = null;
    withdrawNotice = "";
    renderWithdrawal();
    byId("withdraw-amount").focus();
  });
  byId("withdraw-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!withdrawConfirmation) return changeWithdrawal(false);
  });
  byId("confirm-withdraw").addEventListener("click", () => changeWithdrawal(true));

  async function changeWithdrawal(confirmed) {
    if (savingsWritePending || withdrawGoalId === null || (confirmed && !withdrawConfirmation)) return;
    byId("goal-status").textContent = "";
    const amount = parseAmount(byId("withdraw-amount").value);
    fieldError("withdraw-amount", amount === null ? "Введите целую сумму от 1 до 9 007 199 254 740 991 ₸." : "");
    if (amount === null) { byId("withdraw-amount").focus(); return; }
    const id = withdrawGoalId;
    const confirmation = confirmed ? withdrawConfirmation : null;
    let saved = false;
    let requestedConfirmation = false;
    savingsWritePending = true;
    withdrawNotice = "";
    renderSavings(new Date());
    try {
      const withdraw = () => {
        loadSavings();
        if (!savingsReadable) return;
        const goal = savings.goals.find((item) => item.id === id);
        if (!goal) return;
        if (confirmed && (withdrawConfirmation !== confirmation || JSON.stringify(goal) !== confirmation.goal || amount !== confirmation.amount)) {
          withdrawConfirmation = null;
          withdrawNotice = "Данные изменились. Проверьте результат и нажмите «Снять» заново.";
          return;
        }
        const balance = goalBalance(goal) - BigInt(amount);
        if (balance < 0n && !confirmed) {
          withdrawConfirmation = { id, amount, goal: JSON.stringify(goal) };
          requestedConfirmation = true;
          return;
        }
        const operation = { id: savingsId(), type: "withdraw", amount, date: localDate(), confirmedNegative: balance < 0n };
        const next = { ...savings, goals: savings.goals.map((item) => item.id === id ? { ...item, operations: [...item.operations, operation] } : item) };
        localStorage.setItem(SAVINGS_KEY, JSON.stringify(next));
        savings = next;
        saved = true;
        closeWithdrawal();
        byId("goal-status").textContent = "Снятие сохранено";
      };
      if (navigator.locks?.request) await navigator.locks.request(SAVINGS_KEY, withdraw);
      else withdraw();
    } catch {
      withdrawConfirmation = null;
      savingsError("Не удалось сохранить снятие. Введённая сумма оставлена, попробуйте снова.");
    } finally {
      savingsWritePending = false;
      renderSavings(new Date());
      if (saved) focusGoalAction("withdraw", id);
      else if (requestedConfirmation && withdrawConfirmation) byId("cancel-withdraw-confirm").focus();
      else if (!withdrawConfirmation) byId("withdraw-amount").focus();
    }
  }

  function closeGoalForm() {
    byId("goal-editor").hidden = true;
    byId("create-goal").setAttribute("aria-expanded", "false");
    byId("goal-form").reset();
    goalFields.forEach((id) => fieldError(id, ""));
    byId("goal-date-preview").textContent = "";
    byId("create-goal").focus();
  }
  byId("create-goal").addEventListener("click", () => {
    if (!savingsReadable || savingsWritePending) return;
    renderSavings(new Date());
    byId("goal-status").textContent = "";
    byId("goal-editor").hidden = false;
    byId("create-goal").setAttribute("aria-expanded", "true");
    byId("goal-name").focus();
  });
  byId("cancel-goal").addEventListener("click", () => {
    if (!savingsWritePending) closeGoalForm();
  });
  byId("goal-date").addEventListener("input", () => {
    const value = byId("goal-date").value;
    byId("goal-date-preview").textContent = validDate(value) ? displayDate(value) : "";
  });

  byId("goal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (savingsWritePending || byId("goal-editor").hidden) return;
    byId("goal-status").textContent = "";
    const name = byId("goal-name").value.trim();
    const description = byId("goal-description").value.trim();
    const target = parseAmount(byId("goal-target").value);
    const initialText = byId("goal-initial").value.trim().replace(/[ \u00a0\u202f]/g, "");
    const initial = /^0+$/.test(initialText) ? 0 : parseAmount(initialText);
    const date = byId("goal-date").value;
    fieldError("goal-name", !name || Array.from(name).length > 100 ? "Введите название от 1 до 100 символов." : "");
    fieldError("goal-description", Array.from(description).length > 1000 ? "Описание — не больше 1 000 символов." : "");
    fieldError("goal-target", target === null ? "Введите целую сумму от 1 до 9 007 199 254 740 991 ₸." : "");
    fieldError("goal-initial", initial === null ? "Введите целую сумму от 0 до 9 007 199 254 740 991 ₸." : "");
    fieldError("goal-date", !validDate(date) ? "Укажите корректную желаемую дату." : "");
    const invalid = byId("goal-form").querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    savingsWritePending = true;
    renderSavings(new Date());
    const create = () => {
      loadSavings();
      if (!savingsReadable) return;
      const operations = initial ? [{ id: savingsId(), type: "initial", amount: initial, date: localDate() }] : [];
      const goal = { id: savingsId(), name, description, target, date, operations };
      const next = { version: 1, goals: [goal, ...savings.goals] };
      localStorage.setItem(SAVINGS_KEY, JSON.stringify(next));
      savings = next;
      closeGoalForm();
      byId("goal-status").textContent = "Цель создана";
    };
    try {
      if (navigator.locks?.request) await navigator.locks.request(SAVINGS_KEY, create);
      else create();
    } catch {
      savingsError("Не удалось сохранить цель. Введённые поля оставлены, попробуйте снова.");
    } finally {
      savingsWritePending = false;
      renderSavings(new Date());
      if (byId("goal-editor").hidden) byId("create-goal").focus();
    }
  });

  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && localDate(date) === value;
  }

  function parseAmount(value) {
    const normalized = value.trim().replace(/[ \u00a0\u202f]/g, "");
    if (!/^\d+$/.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
  }

  function money(value) {
    return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`;
  }

  function total(records) {
    return records.reduce((sum, record) => sum + BigInt(record.amount), 0n);
  }

  function displayDate(value) {
    return value.split("-").reverse().join(".");
  }

  function fieldError(id, message) {
    byId(id).setAttribute("aria-invalid", String(Boolean(message)));
    byId(`${id}-error`).textContent = message;
    byId(`${id}-error`).hidden = !message;
  }

  function storageError(message) {
    byId("storage-error").textContent = message;
    byId("storage-error").hidden = !message;
  }

  function budgetError(message) {
    byId("budget-error").textContent = message;
    byId("budget-error").hidden = !message;
  }

  function validLimits(saved) {
    return saved && typeof saved === "object" && !Array.isArray(saved) &&
      Object.entries(saved).every(([month, limits]) =>
        /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) && limits &&
        typeof limits === "object" && !Array.isArray(limits) &&
        Object.entries(limits).every(([name, amount]) => name.trim().length > 0 &&
          Number.isSafeInteger(amount) && amount > 0));
  }

  function validExpense(item) {
    return item && Number.isSafeInteger(item.amount) && item.amount > 0 &&
      typeof item.category === "string" && validDate(item.date) && typeof item.comment === "string";
  }

  function validateDaily(saved) {
    if (!saved || saved.version !== 1 || !Array.isArray(saved.articles) ||
        !Array.isArray(saved.expenses) || !validLimits(saved.legacyBudgets)) throw new Error("Invalid daily data");
    const ids = new Set();
    saved.articles.forEach((article) => {
      // Imported names are preserved exactly, even when longer than the new input limit.
      if (!article || typeof article.id !== "string" || !article.id || ids.has(article.id) ||
          typeof article.name !== "string" || !article.name.trim() ||
          !["month", "week"].includes(article.period) || typeof article.archived !== "boolean" ||
          (article.limit !== null && (!Number.isSafeInteger(article.limit) || article.limit <= 0))) {
        throw new Error("Invalid article");
      }
      ids.add(article.id);
    });
    if (!saved.expenses.every((item) => validExpense(item) && ids.has(item.category))) {
      throw new Error("Invalid expense reference");
    }
    return saved;
  }

  function migrateDaily() {
    const expenseRaw = localStorage.getItem(STORAGE_KEY);
    const budgetRaw = localStorage.getItem(BUDGET_KEY);
    const oldExpenses = expenseRaw === null ? [] : JSON.parse(expenseRaw);
    const oldBudgets = budgetRaw === null ? {} : JSON.parse(budgetRaw);
    if (!Array.isArray(oldExpenses) || !oldExpenses.every((item) => validExpense(item) && item.category.trim()) ||
        !validLimits(oldBudgets)) throw new Error("Invalid legacy data");
    const names = new Set(oldExpenses.map((item) => item.category));
    Object.values(oldBudgets).forEach((limits) => Object.keys(limits).forEach((name) => names.add(name)));
    const month = localDate().slice(0, 7);
    const articles = [...names].map((name, index) => ({
      id: `imported-${index + 1}`, name, period: "month", archived: false,
      limit: Object.hasOwn(oldBudgets[month] || {}, name) ? oldBudgets[month][name] : null
    }));
    const ids = new Map(articles.map((article) => [article.name, article.id]));
    const next = validateDaily({
      version: 1, articles,
      expenses: oldExpenses.map((item) => ({ ...item, category: ids.get(item.category) })),
      legacyBudgets: oldBudgets
    });
    // One atomic write completes migration. Both original keys stay untouched as backup.
    localStorage.setItem(DAILY_KEY, JSON.stringify(next));
    return next;
  }

  function applyDaily(saved, raw) {
    daily = saved;
    expenses = saved.expenses;
    categories = saved.articles.map((article) => article.id);
    savedSnapshot = raw;
    storageReadable = true;
    budgetsReadable = true;
    storageError("");
    budgetError("");
  }

  function saveDaily(next) {
    validateDaily(next);
    const raw = JSON.stringify(next);
    localStorage.setItem(DAILY_KEY, raw);
    applyDaily(next, raw);
  }

  function load(allowMigration = false) {
    try {
      const raw = localStorage.getItem(DAILY_KEY);
      if (raw !== null && raw === savedSnapshot && storageReadable) return;
      const saved = raw === null && allowMigration ? migrateDaily() : validateDaily(JSON.parse(raw));
      selectedExpense = null;
      applyDaily(saved, raw === null ? JSON.stringify(saved) : raw);
    } catch {
      storageReadable = false;
      budgetsReadable = false;
      storageError("Не удалось прочитать или перенести статьи и траты. Изменения приостановлены, исходные данные сохранены. Попробуйте обновить страницу.");
      budgetError("Статьи и лимиты недоступны. Сохранённые данные не изменены.");
    }
  }

  function articleNameError(name, exceptId = null) {
    if (!name || name.length > 100) return "Введите название от 1 до 100 символов.";
    if (daily.articles.some((article) => article.id !== exceptId && article.name.trim().toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) {
      return "Такая статья уже есть. Выберите другое название или восстановите статью из архива.";
    }
    return "";
  }

  function closeArticleEditor() {
    const id = editArticleId;
    editArticleId = null;
    editArticleSnapshot = null;
    editArticleConflict = false;
    byId("article-editor").hidden = true;
    byId("article-editor").reset();
    fieldError("article-name", "");
    fieldError("article-amount", "");
    fieldError("article-period", "");
    byId("create-article").setAttribute("aria-expanded", "false");
    (byId(`article-edit-${id}`) || byId("create-article")).focus();
  }

  function renderArticleEditorState() {
    const article = daily.articles.find((item) => item.id === editArticleId);
    if (editArticleId !== null && storageReadable && (!article || JSON.stringify(article) !== editArticleSnapshot)) {
      editArticleConflict = true;
    }
    const message = !storageReadable ? "Статьи недоступны. Попробуйте обновить страницу."
      : editArticleConflict ? "Статья изменена или удалена в другой вкладке. Отмените правку и откройте статью заново." : "";
    byId("article-edit-state").textContent = message;
    byId("article-edit-state").hidden = !message;
    byId("save-article").disabled = !storageReadable || editArticleConflict;
  }

  function openArticleEdit(id) {
    if (expenseWritePending) return;
    load();
    const article = storageReadable && daily.articles.find((item) => item.id === id);
    if (!article) { render(); return; }
    articleAction = null;
    editArticleId = id;
    editArticleSnapshot = JSON.stringify(article);
    editArticleConflict = false;
    byId("article-name").value = article.name;
    byId("article-amount").value = article.limit === null ? "" : String(article.limit).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    byId("article-period").value = article.period;
    fieldError("article-name", "");
    fieldError("article-amount", "");
    fieldError("article-period", "");
    byId("article-form-heading").textContent = "Изменить статью";
    byId("article-edit-note").hidden = false;
    byId("article-editor").hidden = false;
    byId("create-article").setAttribute("aria-expanded", "false");
    byId("article-status").textContent = "";
    render();
    byId("article-name").focus();
  }

  function articleActionMessage(action) {
    const article = daily.articles.find((item) => item.id === action.id);
    if (!storageReadable) return "Статьи недоступны. Попробуйте обновить страницу.";
    if (!article || JSON.stringify(article) !== action.snapshot) action.conflict = true;
    if (action.type === "delete" && expenses.some((item) => item.category === action.id)) {
      action.conflict = true;
      return "У статьи есть траты. Удаление недоступно; используйте архив.";
    }
    return action.conflict ? "Статья изменена или удалена в другой вкладке. Отмените действие и откройте статью заново." : "";
  }

  function renderArticleAction() {
    byId("article-action").hidden = articleAction === null;
    if (!articleAction) return;
    const message = articleActionMessage(articleAction);
    byId("article-action-state").textContent = message;
    byId("article-action-state").hidden = !message;
    byId("confirm-article-action").disabled = Boolean(message);
  }

  function openArticleAction(id, type) {
    if (expenseWritePending) return;
    load();
    const article = storageReadable && daily.articles.find((item) => item.id === id);
    if (!article) { render(); return; }
    const action = { id, type, snapshot: JSON.stringify(article), conflict: false };
    if (type === "restore") {
      closeArticleEditor();
      articleAction = null;
      void commitArticleAction(action);
      return;
    }
    if (type === "delete" && expenses.some((item) => item.category === id)) { render(); return; }
    closeArticleEditor();
    articleAction = action;
    byId("article-status").textContent = "";
    byId("article-action-heading").textContent = type === "archive" ? `В архив: «${article.name}»?` : `Удалить статью «${article.name}»?`;
    byId("article-action-description").textContent = type === "archive"
      ? "Статья исчезнет из выбора новых трат и текущего плана. Расходы сохранятся в истории и итогах, поэтому общий остаток может уменьшиться. Статью можно восстановить из архива."
      : "У статьи нет трат. После подтверждения восстановить удалённую статью нельзя.";
    byId("confirm-article-action").textContent = type === "archive" ? "В архив" : "Удалить";
    render();
    byId("cancel-article-action").focus();
  }

  async function commitArticleAction(action) {
    if (expenseWritePending) return;
    byId("article-status").textContent = "";
    await changeExpenses(() => {
      load();
      const message = articleActionMessage(action);
      if (message) {
        byId("article-status").textContent = "";
        if (action.type === "restore") budgetError(message);
        render();
        return;
      }
      const articles = action.type === "delete" ? daily.articles.filter((item) => item.id !== action.id)
        : daily.articles.map((item) => item.id === action.id ? { ...item, archived: action.type === "archive" } : item);
      try {
        saveDaily({ ...daily, articles });
      } catch {
        budgetError("Не удалось сохранить действие со статьёй. Данные не изменены, попробуйте снова.");
        render();
        return;
      }
      articleAction = null;
      render();
      byId("article-status").textContent = action.type === "delete" ? "Статья удалена" : action.type === "archive" ? "Статья в архиве" : "Статья восстановлена";
      (byId(`article-edit-${action.id}`) || byId("create-article")).focus();
    });
  }

  byId("confirm-article-action").addEventListener("click", () => {
    if (articleAction) void commitArticleAction(articleAction);
  });
  byId("cancel-article-action").addEventListener("click", () => {
    if (expenseWritePending) return;
    const id = articleAction?.id;
    articleAction = null;
    renderArticleAction();
    (byId(`article-edit-${id}`) || byId("create-article")).focus();
  });

  document.querySelectorAll("[data-create-article]").forEach((button) => {
    button.addEventListener("click", () => {
      if (expenseWritePending) return;
      if (editArticleId !== null) closeArticleEditor();
      articleAction = null;
      showView("budget");
      byId("article-form-heading").textContent = "Новая статья";
      byId("article-edit-note").hidden = true;
      byId("article-editor").hidden = false;
      byId("create-article").setAttribute("aria-expanded", "true");
      byId("article-status").textContent = "";
      byId("article-name").focus();
    });
  });
  byId("cancel-article").addEventListener("click", () => {
    if (!expenseWritePending) closeArticleEditor();
  });
  byId("article-editor").addEventListener("submit", (event) => {
    event.preventDefault();
    if (expenseWritePending) return;
    const name = byId("article-name").value.trim();
    const amount = parseAmount(byId("article-amount").value);
    const period = byId("article-period").value;
    renderArticleEditorState();
    if (!storageReadable || editArticleConflict) return;
    const editingId = editArticleId;
    const editingSnapshot = editArticleSnapshot;
    fieldError("article-name", articleNameError(name, editingId));
    fieldError("article-amount", amount === null ? "Введите положительную целую сумму до 9 007 199 254 740 991 ₸." : "");
    fieldError("article-period", ["month", "week"].includes(period) ? "" : "Выберите месяц или неделю.");
    const invalid = byId("article-editor").querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    const enteredName = byId("article-name").value;
    const enteredAmount = byId("article-amount").value;
    byId("article-status").textContent = "";
    void changeExpenses(() => {
      load();
      if (!storageReadable) { render(); return; }
      renderArticleEditorState();
      if (editingId !== editArticleId || editingSnapshot !== editArticleSnapshot || editArticleConflict) { render(); return; }
      const error = articleNameError(name, editingId);
      fieldError("article-name", error);
      if (error) { byId("article-name").focus(); render(); return; }
      let id = editingId;
      if (id === null) do { id = savingsId(); } while (daily.articles.some((article) => article.id === id));
      const articles = editingId === null ? [...daily.articles, { id, name, limit: amount, period, archived: false }]
        : daily.articles.map((article) => article.id === id ? { ...article, name, limit: amount, period } : article);
      try {
        saveDaily({ ...daily, articles });
      } catch {
        budgetError("Не удалось сохранить статью. Поля сохранены, попробуйте снова.");
        render();
        return;
      }
      if (byId("article-name").value === enteredName && byId("article-amount").value === enteredAmount && byId("article-period").value === period) {
        closeArticleEditor();
      } else if (editingId !== null) {
        editArticleSnapshot = JSON.stringify(daily.articles.find((article) => article.id === editingId));
      }
      render();
      if (editingId === null) byId("category").value = id;
      if (byId("article-editor").hidden) (byId(`article-edit-${id}`) || byId("create-article")).focus();
      byId("article-status").textContent = editingId === null ? "Статья создана" : "Статья изменена";
    });
  });

  let renderedArticleChoices = "";
  function renderArticleChoices() {
    const active = storageReadable ? daily.articles.filter((article) => !article.archived) : [];
    const signature = JSON.stringify(active.map(({ id, name }) => [id, name]));
    const select = byId("category");
    if (signature !== renderedArticleChoices) {
      const previous = select.value;
      const options = active.map((article) => {
        const option = document.createElement("option");
        option.value = article.id;
        option.textContent = article.name;
        return option;
      });
      select.replaceChildren(...options);
      if (active.some((article) => article.id === previous)) select.value = previous;
      else if (previous) select.value = "";
      renderedArticleChoices = signature;
    }
    select.disabled = !active.length;
    byId("category-hint").textContent = storageReadable
      ? "Сначала создайте статью в бюджете." : "Статьи недоступны. Попробуйте обновить страницу.";
    byId("category-hint").hidden = active.length > 0;
    byId("expense-create-article").hidden = !storageReadable || active.length > 0;
    byId("create-article").disabled = !storageReadable;
    renderArticleEditorState();
    renderArticleAction();
    byId("budget-empty").hidden = !storageReadable || active.length > 0;
  }

  let renderedArticleCards = "";

  function budgetCalendar(now) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 6) % 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return { monthStart, monthEnd, weekStart, weekEnd };
  }

  function articleDayPlan(article, date) {
    if (article.limit === null || article.archived) return null;
    const days = article.period === "week" ? 7 : new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate();
    const index = article.period === "week" ? (date.getDay() + 6) % 7 : date.getDate() - 1;
    const limit = BigInt(article.limit);
    return limit / BigInt(days) + (BigInt(index) < limit % BigInt(days) ? 1n : 0n);
  }

  function articlePlanBetween(article, first, last) {
    if (article.limit === null || article.archived) return null;
    let sum = 0n;
    // Advance calendar dates, never divide elapsed milliseconds by a day length.
    for (const day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
      sum += articleDayPlan(article, day);
    }
    return sum;
  }

  function articleBudget(article, now, calendar) {
    const weekly = article.period === "week";
    const start = localDate(weekly ? calendar.weekStart : calendar.monthStart);
    const end = localDate(weekly ? calendar.weekEnd : calendar.monthEnd);
    const weekStart = weekly || calendar.weekStart >= calendar.monthStart ? calendar.weekStart : calendar.monthStart;
    const weekEnd = weekly || calendar.weekEnd <= calendar.monthEnd ? calendar.weekEnd : calendar.monthEnd;
    const limit = article.limit === null || article.archived ? null : BigInt(article.limit);
    const spent = storageReadable ? total(expenses.filter((item) => item.category === article.id && item.date >= start && item.date <= end)) : null;
    return {
      start, end, weekStart: localDate(weekStart), weekEnd: localDate(weekEnd),
      label: `${weekly ? "Неделя" : "Месяц"} · ${displayDate(start)}–${displayDate(end)}`,
      limit, spent, remaining: limit !== null && spent !== null ? limit - spent : null,
      dayPlan: articleDayPlan(article, now),
      weekPlan: articlePlanBetween(article, weekStart, weekEnd),
      monthPlan: articlePlanBetween(article, calendar.monthStart, calendar.monthEnd)
    };
  }

  function budgetMoney(value) {
    return value === null ? "—" : savingsMoney(value);
  }

  function renderBudget(now) {
    const month = localDate(now).slice(0, 7);
    const calendar = budgetCalendar(now);
    const articleTotals = new Map(daily.articles.map((article) => [article.id, articleBudget(article, now, calendar)]));
    renderArticleChoices();
    const cardSignature = JSON.stringify(daily.articles);
    if (renderedArticleCards !== cardSignature) {
      const fragment = document.createDocumentFragment();
      const archive = document.createDocumentFragment();
      categories.forEach((category, index) => {
        const article = daily.articles[index];
        const row = document.createElement("section");
        row.className = "budget-category";
        const heading = document.createElement("h3");
        heading.id = `budget-heading-${index}`;
        heading.textContent = categoryName(category);
        row.setAttribute("aria-labelledby", heading.id);
        row.append(heading);
        [["period", "budget-note"], ["limit", "budget-limit"], ["spent", "budget-amount"], ["remaining", "budget-amount"], ["day-plan", "budget-amount"], ["week-plan", "budget-amount"], ["warning", "budget-warning"]].forEach(([key, className]) => {
          const text = document.createElement("p");
          text.id = `budget-${key}-${index}`;
          text.className = className;
          row.append(text);
        });
        const controls = document.createElement("div");
        controls.className = "budget-controls";
        [["edit", "Изменить"], [article.archived ? "restore" : "archive", article.archived ? "Восстановить" : "В архив"], ["delete", "Удалить"]].forEach(([action, label]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.id = `article-${action}-${category}`;
          button.textContent = label;
          button.setAttribute("aria-label", `${label}: «${article.name}»`);
          button.addEventListener("click", () => action === "edit" ? openArticleEdit(category) : openArticleAction(category, action));
          if (action === "delete") button.setAttribute("aria-describedby", `article-delete-hint-${category}`);
          controls.append(button);
        });
        const hint = document.createElement("p");
        hint.id = `article-delete-hint-${category}`;
        hint.className = "budget-note";
        row.append(controls, hint);
        (article.archived ? archive : fragment).append(row);
      });
      byId("budget-categories").replaceChildren(fragment);
      byId("archived-articles").replaceChildren(archive);
      renderedArticleCards = cardSignature;
    }
    byId("article-archive").hidden = !daily.articles.some((article) => article.archived);
    byId("budget-month").textContent = now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    byId("month-label").textContent = byId("budget-month").textContent;
    const spentByCategory = new Map(categories.map((category) => [category, 0n]));
    if (storageReadable) expenses.forEach((item) => {
      if (item.date.startsWith(`${month}-`)) spentByCategory.set(item.category, spentByCategory.get(item.category) + BigInt(item.amount));
    });
    byId("budget-expenses-error").textContent = storageReadable ? "" : "Не удалось прочитать траты. Потраченные суммы и остатки пока недоступны.";
    byId("budget-expenses-error").hidden = storageReadable;
    const limits = [...articleTotals.values()].filter((stats) => stats.monthPlan !== null);
    const budgetTotal = limits.reduce((sum, stats) => sum + stats.monthPlan, 0n);
    const spentTotal = [...spentByCategory.values()].reduce((sum, amount) => sum + amount, 0n);
    const remainingTotal = storageReadable && budgetsReadable && limits.length ? budgetTotal - spentTotal : null;
    byId("budget-total").textContent = !budgetsReadable ? "—" : limits.length ? money(budgetTotal) : "Не задан";
    byId("budget-spent").textContent = storageReadable ? money(spentTotal) : "—";
    byId("budget-remaining").textContent = remainingTotal === null ? "—" : remainingTotal < 0n ? `−${money(-remainingTotal)}` : money(remainingTotal);
    byId("budget-limit-count").textContent = `Лимиты заданы: ${budgetsReadable ? limits.length : "—"} из ${daily.articles.filter((article) => !article.archived).length}`;
    const totalWarning = byId("budget-warning");
    totalWarning.textContent = remainingTotal !== null && remainingTotal < 0n ? `Перерасход бюджета: ${money(-remainingTotal)}` : "";
    totalWarning.hidden = !totalWarning.textContent;
    categories.forEach((category, index) => {
      const article = daily.articles[index];
      const stats = articleTotals.get(category);
      const periodName = article.period === "week" ? "неделю" : "месяц";
      byId(`budget-period-${index}`).textContent = stats.label;
      byId(`budget-limit-${index}`).textContent = !budgetsReadable ? "Лимит: —"
        : article.archived ? article.limit === null ? "В архиве · Лимит не задан" : `В архиве · Сохранённый лимит в ${periodName}: ${money(article.limit)}`
        : stats.limit === null ? "Лимит не задан" : `Лимит в ${periodName}: ${money(stats.limit)}`;
      const remaining = budgetsReadable ? stats.remaining : null;
      byId(`budget-spent-${index}`).textContent = `Потрачено за период: ${budgetMoney(stats.spent)}`;
      byId(`budget-remaining-${index}`).textContent = `Осталось: ${budgetMoney(remaining)}`;
      byId(`budget-day-plan-${index}`).textContent = `План на сегодня (${displayDate(localDate(now))}): ${budgetMoney(budgetsReadable ? stats.dayPlan : null)}`;
      byId(`budget-week-plan-${index}`).textContent = `План недели (${displayDate(stats.weekStart)}–${displayDate(stats.weekEnd)}): ${budgetMoney(budgetsReadable ? stats.weekPlan : null)}`;
      const warning = byId(`budget-warning-${index}`);
      warning.textContent = remaining !== null && remaining < 0n ? `Перерасход: ${money(-remaining)}` : "";
      warning.hidden = !warning.textContent;
      const hasExpenses = expenses.some((item) => item.category === category);
      byId(`article-edit-${category}`).disabled = !storageReadable;
      byId(`article-${article.archived ? "restore" : "archive"}-${category}`).disabled = !storageReadable;
      byId(`article-delete-${category}`).disabled = !storageReadable || hasExpenses;
      const hint = byId(`article-delete-hint-${category}`);
      hint.textContent = !storageReadable ? "Не удалось проверить траты. Удаление недоступно."
        : hasExpenses ? article.archived ? "Есть траты. Статью с тратами удалить нельзя." : "Есть траты. Вместо удаления используйте «В архив»." : "";
      hint.hidden = !hint.textContent;
    });
    renderOverviewBudget(month, articleTotals, budgetTotal, spentTotal, remainingTotal, limits.length);
    renderOverviewAnalytics(now, month, spentByCategory, spentTotal);
    renderRecentExpenses(month);
  }

  function renderRecentExpenses(month) {
    const recent = storageReadable ? expenses.filter((item) => item.date.startsWith(`${month}-`)).slice(0, 5) : [];
    const state = byId("recent-state");
    state.textContent = storageReadable ? "В этом месяце трат пока нет" : "Не удалось прочитать траты. Последние записи пока недоступны.";
    state.hidden = storageReadable && recent.length > 0;
    const fragment = document.createDocumentFragment();
    recent.forEach((item) => {
      const row = document.createElement("li");
      row.className = "recent-expense";
      const category = document.createElement("strong");
      category.className = "recent-category";
      category.textContent = categoryName(item.category);
      const amount = document.createElement("strong");
      amount.className = "recent-amount";
      amount.textContent = money(item.amount);
      const date = document.createElement("time");
      date.className = "recent-date";
      date.dateTime = item.date;
      date.textContent = displayDate(item.date);
      row.append(category, amount, date);
      if (item.comment) {
        const comment = document.createElement("p");
        comment.className = "recent-comment";
        comment.textContent = item.comment;
        row.append(comment);
      }
      fragment.append(row);
    });
    byId("recent-expenses").replaceChildren(fragment);
  }

  function renderOverviewAnalytics(now, month, spentByCategory, spentTotal) {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyTotals = Array(daysInMonth).fill(0n);
    if (storageReadable) {
      expenses.forEach((item) => {
        if (item.date.startsWith(`${month}-`)) dailyTotals[Number(item.date.slice(8)) - 1] += BigInt(item.amount);
      });
    }
    const maximum = dailyTotals.reduce((max, amount) => amount > max ? amount : max, 0n);
    const state = byId("daily-state");
    state.textContent = storageReadable ? "В этом месяце трат пока нет" : "Не удалось прочитать траты. Динамика пока недоступна.";
    state.hidden = storageReadable && spentTotal > 0n;
    byId("daily-figure").hidden = !storageReadable;
    byId("daily-scale").textContent = storageReadable ? `Максимум за день: ${money(maximum)}` : "";
    const chart = document.createDocumentFragment();
    const dates = document.createDocumentFragment();
    dailyTotals.forEach((amount, index) => {
      const day = index + 1;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      if (storageReadable) {
        const column = document.createElement("div");
        column.className = "day-column";
        const bar = document.createElement("div");
        bar.className = "day-bar";
        bar.style.height = `${maximum ? Number(amount * 10000n / maximum) / 100 : 0}%`;
        const label = document.createElement("span");
        label.className = "day-label";
        label.textContent = day === 1 || day === daysInMonth || (day % 5 === 0 && day <= daysInMonth - 3) ? String(day) : "";
        column.append(bar, label);
        chart.append(column);
      }
      const row = document.createElement("div");
      const name = document.createElement("dt");
      const time = document.createElement("time");
      time.dateTime = date;
      time.textContent = displayDate(date);
      name.append(time);
      const value = document.createElement("dd");
      value.textContent = storageReadable ? money(amount) : "—";
      row.append(name, value);
      dates.append(row);
    });
    byId("daily-chart").style.gridTemplateColumns = `repeat(${daysInMonth}, minmax(0, 1fr))`;
    byId("daily-chart").replaceChildren(chart);
    byId("daily-totals").replaceChildren(dates);
    const categoryRows = document.createDocumentFragment();
    categories.forEach((category) => {
      const row = document.createElement("div");
      const name = document.createElement("dt");
      name.textContent = categoryName(category);
      const value = document.createElement("dd");
      const amount = spentByCategory.get(category);
      const sum = document.createElement("span");
      sum.textContent = storageReadable ? money(amount) : "—";
      const track = document.createElement("span");
      track.className = "category-share-track";
      track.setAttribute("aria-hidden", "true");
      track.hidden = !storageReadable;
      const fill = document.createElement("span");
      fill.className = "category-share-fill";
      fill.style.width = `${spentTotal ? Number(amount * 10000n / spentTotal) / 100 : 0}%`;
      track.append(fill);
      value.append(sum, track);
      row.append(name, value);
      categoryRows.append(row);
    });
    byId("month-category-totals").replaceChildren(categoryRows);
  }

  function renderOverviewBudget(month, articleTotals, budgetTotal, spentTotal, remainingTotal, limitCount) {
    byId("month-total").textContent = storageReadable ? money(spentTotal) : "—";
    byId("expenses-month-total").textContent = byId("month-total").textContent;
    byId("overview-budget-total").textContent = !budgetsReadable ? "—" : limitCount ? money(budgetTotal) : "Не задан";
    byId("overview-remaining").textContent = remainingTotal === null ? "—" : remainingTotal < 0n ? `−${money(-remainingTotal)}` : money(remainingTotal);
    byId("overview-remaining").className = remainingTotal !== null && remainingTotal < 0n ? "is-over-budget" : "";
    byId("overview-expense-count").textContent = storageReadable ? String(expenses.filter((item) => item.date.startsWith(`${month}-`)).length) : "—";
    byId("overview-limit-count").textContent = `Лимиты: ${budgetsReadable ? limitCount : "—"} из ${daily.articles.filter((article) => !article.archived).length}`;
    byId("overview-budget-note").textContent = !budgetsReadable ? "Лимиты недоступны. Бюджет и остатки пока неизвестны." : !limitCount
      ? "Задайте лимиты в разделе «Бюджет», чтобы видеть остатки."
      : "Остаток рассчитан по активным лимитам. Расходы включают все статьи, в том числе архивные и без лимита.";
    const warning = byId("overview-budget-warning");
    warning.textContent = remainingTotal !== null && remainingTotal < 0n ? `Перерасход бюджета: ${money(-remainingTotal)}` : "";
    warning.hidden = !warning.textContent;
    const fragment = document.createDocumentFragment();
    categories.forEach((category, index) => {
      if (daily.articles[index].archived) return;
      const row = document.createElement("section");
      row.className = "overview-budget-category";
      const heading = document.createElement("h3");
      heading.id = `overview-category-${index}`;
      heading.textContent = categoryName(category);
      row.setAttribute("aria-labelledby", heading.id);
      const stats = articleTotals.get(category);
      const limit = budgetsReadable ? stats.limit : null;
      const spent = stats.spent;
      const remaining = budgetsReadable ? stats.remaining : null;
      const period = document.createElement("p");
      period.className = "budget-note";
      period.textContent = stats.label;
      const details = document.createElement("dl");
      details.className = "overview-category-values";
      const values = [
        ["Потрачено", budgetMoney(spent)],
        ["Лимит", !budgetsReadable ? "—" : limit === null ? "Не задан" : money(limit)],
        ["Осталось", remaining === null ? "—" : remaining < 0n ? `−${money(-remaining)}` : money(remaining)]
      ];
      values.forEach(([label, value]) => {
        const pair = document.createElement("div");
        const name = document.createElement("dt");
        name.textContent = label;
        const amount = document.createElement("dd");
        amount.textContent = value;
        pair.append(name, amount);
        details.append(pair);
      });
      const track = document.createElement("div");
      track.className = "budget-track";
      track.setAttribute("aria-hidden", "true");
      track.hidden = !storageReadable || limit === null;
      const fill = document.createElement("div");
      fill.className = remaining !== null && remaining < 0n ? "budget-fill is-over-budget" : "budget-fill";
      // Divide as integers first: only the bounded display percentage becomes a Number.
      const ratio = limit !== null && spent !== null ? spent * 10000n / limit : 0n;
      fill.style.width = `${Number(ratio > 10000n ? 10000n : ratio) / 100}%`;
      track.append(fill);
      const categoryWarning = document.createElement("p");
      categoryWarning.className = "overview-category-warning";
      categoryWarning.textContent = remaining !== null && remaining < 0n ? `Перерасход: ${money(-remaining)}` : "";
      categoryWarning.hidden = !categoryWarning.textContent;
      row.append(heading, period, details, track, categoryWarning);
      fragment.append(row);
    });
    byId("overview-budget-categories").replaceChildren(fragment);
  }

  function render() {
    const now = new Date();
    void synchronizeObligationSchedule();
    renderObligations();
    renderIncomes();
    renderSavings(now);
    if (!dateEdited) byId("date").value = localDate(now);
    renderBudget(now);
    updateQuickPeriod(now);
    const invalidPeriod = (start.value && !validDate(start.value)) || (end.value && !validDate(end.value)) || (start.value && end.value && start.value > end.value);
    byId("period-error").textContent = invalidPeriod ? "Проверьте период: дата «С» должна быть не позже даты «По»." : "";
    byId("period-error").hidden = !invalidPeriod;
    start.setAttribute("aria-invalid", String(Boolean(invalidPeriod)));
    end.setAttribute("aria-invalid", String(Boolean(invalidPeriod)));
    const visible = invalidPeriod || !storageReadable ? [] : expenses.filter((item) => (!start.value || item.date >= start.value) && (!end.value || item.date <= end.value));
    if (!visible.includes(selectedExpense)) selectedExpense = null;
    byId("delete-expense").disabled = !selectedExpense || !storageReadable;
    byId("period-total").textContent = invalidPeriod || !storageReadable ? "—" : money(total(visible));
    const categoryTotals = new Map(categories.map((category) => [category, 0n]));
    visible.forEach((item) => categoryTotals.set(item.category, categoryTotals.get(item.category) + BigInt(item.amount)));
    const categoryFragment = document.createDocumentFragment();
    categories.forEach((category) => {
      const row = document.createElement("div");
      const name = document.createElement("dt");
      name.textContent = categoryName(category);
      const amount = document.createElement("dd");
      amount.textContent = invalidPeriod || !storageReadable ? "—" : money(categoryTotals.get(category));
      row.append(name, amount);
      categoryFragment.append(row);
    });
    byId("category-totals").replaceChildren(categoryFragment);
    byId("expense-count").textContent = `Записей: ${storageReadable ? visible.length : "—"}`;
    byId("empty-state").hidden = !storageReadable || visible.length > 0 || Boolean(invalidPeriod);
    byId("empty-state").textContent = expenses.length ? "За этот период трат нет" : "Пока нет трат";
    // Keep the actual controls (and keyboard focus) while the list is unchanged.
    const expenseNames = JSON.stringify(daily.articles.map(({ id, name }) => [id, name]));
    if (renderedExpenseNames === expenseNames && renderedStorageReadable === storageReadable && renderedSelection === selectedExpense &&
      renderedExpenses.length === visible.length && renderedExpenses.every((item, index) => item === visible[index])) return;
    const fragment = document.createDocumentFragment();
    visible.forEach((item) => {
      const row = document.createElement("li");
      row.className = "expense";
      const choice = document.createElement("label");
      choice.className = "expense-select";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "selected-expense";
      radio.checked = selectedExpense === item;
      radio.disabled = !storageReadable;
      radio.setAttribute("aria-label", `Выбрать трату: ${categoryName(item.category)}, ${money(item.amount)}, ${displayDate(item.date)}, запись ${expenses.indexOf(item) + 1}`);
      radio.addEventListener("change", () => {
        selectedExpense = item;
        renderedSelection = item;
        byId("delete-expense").disabled = false;
        byId("delete-status").textContent = "";
      });
      choice.append(radio);
      const details = document.createElement("div");
      details.className = "expense-details";
      const category = document.createElement("strong");
      category.className = "expense-category";
      category.textContent = categoryName(item.category);
      const amount = document.createElement("strong");
      amount.className = "expense-amount";
      amount.textContent = money(item.amount);
      const date = document.createElement("time");
      date.className = "expense-date";
      date.dateTime = item.date;
      date.textContent = displayDate(item.date);
      details.append(category, amount, date);
      if (item.comment) {
        const comment = document.createElement("p");
        comment.className = "expense-comment";
        comment.textContent = item.comment;
        details.append(comment);
      }
      row.append(choice, details);
      fragment.append(row);
    });
    byId("expense-list").replaceChildren(fragment);
    renderedExpenses = visible;
    renderedSelection = selectedExpense;
    renderedStorageReadable = storageReadable;
    renderedExpenseNames = expenseNames;
  }

  async function changeExpenses(action) {
    if (expenseWritePending) return;
    expenseWritePending = true;
    try {
      if (typeof navigator !== "undefined" && navigator.locks?.request) {
        await navigator.locks.request(DAILY_KEY, action);
      } else {
        action();
      }
    } catch {
      storageError("Не удалось обновить статьи и траты. Поля сохранены, попробуйте снова.");
    } finally {
      expenseWritePending = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (expenseWritePending) return;
    if (!dateEdited) byId("date").value = localDate();
    byId("save-status").textContent = "";
    const amount = parseAmount(byId("amount").value);
    const category = byId("category").value;
    const date = byId("date").value;
    fieldError("amount", amount === null ? "Введите положительную целую сумму в тенге, например 5 000." : "");
    fieldError("category", daily.articles.some((article) => article.id === category && !article.archived) ? "" : "Выберите активную статью. Если статей нет, создайте её в бюджете.");
    fieldError("date", validDate(date) ? "" : "Укажите корректную дату.");
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    const enteredAmount = byId("amount").value;
    const enteredComment = byId("comment").value;
    changeExpenses(() => {
      // Read inside the lock: a storage event from another tab may still be queued.
      load();
      if (!storageReadable) { render(); return; }
      if (!daily.articles.some((article) => article.id === category && !article.archived)) {
        fieldError("category", "Статья недоступна. Выберите активную статью.");
        render();
        return;
      }
      const next = [{ amount, category, date, comment: enteredComment.trim() }, ...expenses];
      try {
        saveDaily({ ...daily, expenses: next });
      } catch {
        storageError("Не удалось сохранить трату. Проверьте доступ к хранилищу браузера и попробуйте снова. Поля сохранены в форме.");
        render();
        return;
      }
      expenses = next;
      selectedExpense = null;
      byId("delete-status").textContent = "";
      storageError("");
      if (byId("amount").value === enteredAmount) byId("amount").value = "";
      if (byId("comment").value === enteredComment) byId("comment").value = "";
      render();
      byId("save-status").textContent = "Трата добавлена";
      byId("amount").focus();
    });
  });

  function deletionDataIsCurrent() {
    try {
      if (localStorage.getItem(DAILY_KEY) === savedSnapshot) return true;
      load();
      render();
      byId("delete-status").textContent = "Список изменился в другой вкладке. Выберите трату заново.";
    } catch {
      storageError("Не удалось проверить сохранённые траты. Ничего не удалено. Попробуйте снова.");
    }
    return false;
  }

  byId("delete-expense").addEventListener("click", () => {
    if (expenseWritePending) return;
    const target = selectedExpense;
    byId("delete-status").textContent = "";
    if (!storageReadable || !target || !expenses.includes(target) || !deletionDataIsCurrent()) return;
    const comment = target.comment ? `\n${target.comment}` : "";
    if (!window.confirm(`Удалить трату?\n${money(target.amount)} · ${categoryName(target.category)}\n${displayDate(target.date)}${comment}\n\nВосстановить запись после удаления нельзя.`)) return;
    changeExpenses(() => {
      if (!deletionDataIsCurrent() || selectedExpense !== target) return;
      const next = expenses.filter((item) => item !== target);
      try {
        saveDaily({ ...daily, expenses: next });
      } catch {
        storageError("Не удалось сохранить удаление. Трата осталась в списке. Попробуйте снова.");
        return;
      }
      expenses = next;
      selectedExpense = null;
      storageError("");
      byId("save-status").textContent = "";
      render();
      byId("delete-status").textContent = "Трата удалена";
    });
  });

  function markPeriod(period) {
    activePeriod = period;
    selectedExpense = null;
    byId("delete-status").textContent = "";
    document.querySelectorAll("[data-period]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === period)));
  }

  function updateQuickPeriod(now) {
    if (!activePeriod || activePeriod === "all") return;
    const first = new Date(now);
    let periodEnd = localDate(now);
    if (activePeriod === "month") {
      first.setDate(1);
      periodEnd = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    } else {
      first.setDate(first.getDate() - Number(activePeriod) + 1);
    }
    const periodStart = localDate(first);
    if (start.value !== periodStart || end.value !== periodEnd) {
      start.value = periodStart;
      end.value = periodEnd;
      markPeriod(activePeriod);
    }
  }

  document.querySelectorAll("[data-period]").forEach((button) => {
    button.addEventListener("click", () => {
      const period = button.dataset.period;
      markPeriod(period);
      if (period === "all") { start.value = ""; end.value = ""; }
      render();
    });
  });
  [start, end].forEach((input) => input.addEventListener("input", () => { markPeriod(""); render(); }));
  byId("date").addEventListener("input", () => { dateEdited = true; });
  window.addEventListener("storage", (event) => {
    if (event.key !== INCOME_KEY && event.key !== null) return;
    loadIncomes();
    byId("income-status").textContent = "";
    renderIncomes();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== DAILY_KEY && event.key !== SAVINGS_KEY && event.key !== null) return;
    if (event.key === SAVINGS_KEY || event.key === null) {
      loadSavings();
      byId("goal-status").textContent = "";
    }
    if (event.key === DAILY_KEY || event.key === null) {
      load();
      byId("delete-status").textContent = "";
      byId("article-status").textContent = "";
    }
    render();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== OBLIGATION_KEY && event.key !== null) return;
    loadObligations();
    byId("obligation-status").textContent = "";
    void synchronizeObligationSchedule();
    renderObligations();
  });
  window.addEventListener("focus", () => { load(); loadObligations(); loadIncomes(); loadSavings(); render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { load(); loadObligations(); loadIncomes(); loadSavings(); render(); }
  });
  setInterval(() => {
    load();
    render();
  }, 60000);
  byId("date").value = localDate();
  byId("income-date").value = localDate();
  loadObligations();
  loadIncomes();
  loadSavings();
  void changeExpenses(() => { load(true); render(); });
})();
