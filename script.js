"use strict";

(() => {
  const STORAGE_KEY = "family-expenses-v1";
  const BUDGET_KEY = "family-budgets-v1";
  const SAVINGS_KEY = "family-savings-v1";
  const INCOME_KEY = "family-incomes-v1";
  const OBLIGATION_KEY = "family-obligations-v1";
  const categories = ["Продукты", "Транспорт", "Кредит", "Ипотека", "Расходы на секцию ребёнка"];
  const removedCategories = ["Дом", "Другое"];
  const savedCategories = [...categories, "Еда", ...removedCategories];
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
  let storageReadable = true;
  let selectedExpense = null;
  let savedSnapshot = null;
  let activePeriod = "all";
  let budgets = {};
  let budgetsReadable = true;
  let budgetMonth = "";
  let expenseWritePending = false;
  let dateEdited = false;
  const dirtyBudgetInputs = new Set();
  let renderedExpenses = [];
  let renderedSelection = null;
  let renderedStorageReadable = true;
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

  function renderObligations() {
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
    byId("obligation-count").textContent = `Записей: ${obligationsReadable ? obligations.payments.length : "—"}`;
    byId("obligation-empty").textContent = obligationsReadable ? "Пока нет обязательных платежей" : "Не удалось прочитать платежи. Список недоступен.";
    byId("obligation-empty").hidden = obligationsReadable && obligations.payments.length > 0;
    const signature = JSON.stringify([obligationsReadable, obligations, today]);
    if (signature === renderedObligations) return;
    renderedObligations = signature;
    const fragment = document.createDocumentFragment();
    const rules = new Map(obligations.rules.map((rule) => [rule.id, rule]));
    const payments = obligationsReadable ? [...obligations.payments].sort((a, b) =>
      Number(a.status === "paid") - Number(b.status === "paid") || a.date.localeCompare(b.date)) : [];
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
        const ids = new Set([...obligations.rules, ...obligations.payments].map((item) => item.id));
        const uniqueId = () => {
          let id;
          do { id = savingsId(); } while (ids.has(id));
          ids.add(id);
          return id;
        };
        const rule = { id: uniqueId(), name: pending.name, amount: pending.amount, date: pending.date, frequency: pending.frequency };
        const payments = pending.dates.map((date) => ({ id: uniqueId(), ruleId: rule.id, amount: rule.amount, date, status: "unpaid", paidDate: null }));
        const next = { version: 1, rules: [...obligations.rules, rule], payments: [...obligations.payments, ...payments] };
        localStorage.setItem(OBLIGATION_KEY, JSON.stringify(next));
        obligations = next;
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

  function readBudgets() {
    const raw = localStorage.getItem(BUDGET_KEY);
    const saved = raw === null ? {} : JSON.parse(raw);
    const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    if (!isObject(saved) || !Object.entries(saved).every(([month, limits]) =>
      /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) && isObject(limits) &&
      Object.entries(limits).every(([category, amount]) => savedCategories.includes(category) && Number.isSafeInteger(amount) && amount > 0))) {
      throw new Error("Invalid saved budgets");
    }
    const updated = {};
    Object.entries(saved).forEach(([month, limits]) => {
      const next = { ...limits };
      // A newer Products limit takes precedence if both names are present.
      if (next["Еда"] !== undefined && next["Продукты"] === undefined) next["Продукты"] = next["Еда"];
      delete next["Еда"];
      removedCategories.forEach((category) => delete next[category]);
      if (Object.keys(next).length) updated[month] = next;
    });
    if (JSON.stringify(updated) !== JSON.stringify(saved)) {
      localStorage.setItem(BUDGET_KEY, JSON.stringify(updated));
    }
    return updated;
  }

  function loadBudgets() {
    try {
      budgets = readBudgets();
      budgetsReadable = true;
      budgetError("");
    } catch {
      budgetsReadable = false;
      budgetError("Не удалось прочитать или обновить лимиты. Сохранённые данные не изменены. Попробуйте обновить страницу.");
    }
  }

  function changeBudget(category, index, remove) {
    const now = new Date();
    if (localDate(now).slice(0, 7) !== budgetMonth) {
      render();
      budgetError("Начался новый месяц. Задайте лимит заново.");
      return;
    }
    const input = byId(`budget-${index}`);
    const status = byId(`budget-status-${index}`);
    status.textContent = "";
    const amount = remove ? null : parseAmount(input.value);
    fieldError(`budget-${index}`, !remove && amount === null ? "Введите положительную целую сумму до 9 007 199 254 740 991 ₸." : "");
    if (!remove && amount === null) { input.focus(); return; }
    // Read the latest limits before writing so another category's changes are preserved.
    let next;
    try {
      next = readBudgets();
    } catch {
      loadBudgets();
      render();
      return;
    }
    const limits = { ...(next[budgetMonth] || {}) };
    if (remove) delete limits[category];
    else limits[category] = amount;
    if (Object.keys(limits).length) next[budgetMonth] = limits;
    else delete next[budgetMonth];
    try {
      localStorage.setItem(BUDGET_KEY, JSON.stringify(next));
    } catch {
      budgetError("Не удалось сохранить лимит. Данные не изменены, введённая сумма оставлена в поле. Попробуйте снова.");
      return;
    }
    budgets = next;
    budgetsReadable = true;
    budgetError("");
    input.value = remove ? "" : String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    dirtyBudgetInputs.delete(index);
    render();
    status.textContent = remove ? "Лимит убран" : "Лимит сохранён";
  }

  function renderBudget(now, resetInputs = false) {
    const month = localDate(now).slice(0, 7);
    if (month !== budgetMonth) {
      dirtyBudgetInputs.clear();
      budgetMonth = month;
      loadBudgets();
      const fragment = document.createDocumentFragment();
      categories.forEach((category, index) => {
        const row = document.createElement("form");
        row.className = "budget-category";
        row.noValidate = true;
        const heading = document.createElement("h3");
        heading.id = `budget-heading-${index}`;
        heading.textContent = category;
        row.setAttribute("aria-labelledby", heading.id);
        const saved = document.createElement("p");
        saved.id = `budget-limit-${index}`;
        saved.className = "budget-limit";
        const spent = document.createElement("p");
        spent.id = `budget-spent-${index}`;
        spent.className = "budget-amount";
        const remaining = document.createElement("p");
        remaining.id = `budget-remaining-${index}`;
        remaining.className = "budget-amount";
        const warning = document.createElement("p");
        warning.id = `budget-warning-${index}`;
        warning.className = "budget-warning";
        warning.setAttribute("role", "status");
        warning.hidden = true;
        const controls = document.createElement("div");
        controls.className = "budget-controls";
        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("label");
        label.htmlFor = `budget-${index}`;
        label.textContent = "Лимит, ₸";
        const input = document.createElement("input");
        input.id = `budget-${index}`;
        input.type = "text";
        input.inputMode = "numeric";
        input.placeholder = "Например, 20 000";
        input.setAttribute("aria-describedby", `budget-${index}-error`);
        input.addEventListener("input", () => dirtyBudgetInputs.add(index));
        const error = document.createElement("p");
        error.id = `budget-${index}-error`;
        error.className = "error";
        error.setAttribute("role", "alert");
        error.hidden = true;
        const save = document.createElement("button");
        save.type = "submit";
        save.textContent = "Сохранить";
        const remove = document.createElement("button");
        remove.id = `budget-remove-${index}`;
        remove.type = "button";
        remove.textContent = "Убрать лимит";
        remove.addEventListener("click", () => changeBudget(category, index, true));
        const status = document.createElement("p");
        status.id = `budget-status-${index}`;
        status.className = "budget-status";
        status.setAttribute("role", "status");
        field.append(label, input, error);
        controls.append(field, save, remove);
        row.append(heading, saved, spent, remaining, warning, controls, status);
        row.addEventListener("submit", (event) => { event.preventDefault(); changeBudget(category, index, false); });
        fragment.append(row);
      });
      byId("budget-categories").replaceChildren(fragment);
      resetInputs = true;
    }
    byId("budget-month").textContent = now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    byId("month-label").textContent = byId("budget-month").textContent;
    const spentByCategory = new Map(categories.map((category) => [category, 0n]));
    if (storageReadable) {
      expenses.forEach((item) => {
        if (item.date.startsWith(`${month}-`)) {
          spentByCategory.set(item.category, spentByCategory.get(item.category) + BigInt(item.amount));
        }
      });
    }
    byId("budget-expenses-error").textContent = storageReadable ? "" : "Не удалось прочитать траты. Потраченные суммы и остатки пока недоступны.";
    byId("budget-expenses-error").hidden = storageReadable;
    const limits = Object.values(budgets[budgetMonth] || {});
    const budgetTotal = limits.reduce((sum, amount) => sum + BigInt(amount), 0n);
    const spentTotal = [...spentByCategory.values()].reduce((sum, amount) => sum + amount, 0n);
    const remainingTotal = storageReadable && budgetsReadable && limits.length ? budgetTotal - spentTotal : null;
    byId("budget-total").textContent = !budgetsReadable ? "—" : limits.length ? money(budgetTotal) : "Не задан";
    byId("budget-spent").textContent = storageReadable ? money(spentTotal) : "—";
    byId("budget-remaining").textContent = remainingTotal === null ? "—" : remainingTotal < 0n ? `−${money(-remainingTotal)}` : money(remainingTotal);
    byId("budget-limit-count").textContent = `Лимиты заданы: ${budgetsReadable ? limits.length : "—"} из ${categories.length}`;
    const totalWarning = byId("budget-warning");
    totalWarning.textContent = remainingTotal !== null && remainingTotal < 0n ? `Перерасход бюджета: ${money(-remainingTotal)}` : "";
    totalWarning.hidden = !totalWarning.textContent;
    categories.forEach((category, index) => {
      const amount = budgets[budgetMonth]?.[category];
      byId(`budget-limit-${index}`).textContent = !budgetsReadable ? "Лимит: —" : amount === undefined ? "Лимит не задан" : `Лимит: ${money(amount)}`;
      const spent = spentByCategory.get(category);
      const remaining = storageReadable && budgetsReadable && amount !== undefined ? BigInt(amount) - spent : null;
      byId(`budget-spent-${index}`).textContent = `Потрачено: ${storageReadable ? money(spent) : "—"}`;
      byId(`budget-remaining-${index}`).textContent = `Осталось: ${remaining === null ? "—" : remaining < 0n ? `−${money(-remaining)}` : money(remaining)}`;
      const warning = byId(`budget-warning-${index}`);
      warning.textContent = remaining !== null && remaining < 0n ? `Перерасход: ${money(-remaining)}` : "";
      warning.hidden = !warning.textContent;
      byId(`budget-remove-${index}`).disabled = !budgetsReadable || amount === undefined;
      if (resetInputs && !dirtyBudgetInputs.has(index)) {
        byId(`budget-${index}`).value = budgetsReadable && amount !== undefined ? String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "";
        fieldError(`budget-${index}`, "");
        byId(`budget-status-${index}`).textContent = "";
      }
    });
    renderOverviewBudget(month, spentByCategory, budgetTotal, spentTotal, remainingTotal, limits.length);
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
      category.textContent = item.category;
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
      name.textContent = category;
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

  function renderOverviewBudget(month, spentByCategory, budgetTotal, spentTotal, remainingTotal, limitCount) {
    byId("month-total").textContent = storageReadable ? money(spentTotal) : "—";
    byId("expenses-month-total").textContent = byId("month-total").textContent;
    byId("overview-budget-total").textContent = !budgetsReadable ? "—" : limitCount ? money(budgetTotal) : "Не задан";
    byId("overview-remaining").textContent = remainingTotal === null ? "—" : remainingTotal < 0n ? `−${money(-remainingTotal)}` : money(remainingTotal);
    byId("overview-remaining").className = remainingTotal !== null && remainingTotal < 0n ? "is-over-budget" : "";
    byId("overview-expense-count").textContent = storageReadable ? String(expenses.filter((item) => item.date.startsWith(`${month}-`)).length) : "—";
    byId("overview-limit-count").textContent = `Лимиты: ${budgetsReadable ? limitCount : "—"} из ${categories.length}`;
    byId("overview-budget-note").textContent = !budgetsReadable ? "Лимиты недоступны. Бюджет и остатки пока неизвестны." : !limitCount
      ? "Задайте лимиты в разделе «Бюджет», чтобы видеть остатки."
      : "Остаток рассчитан по заданным лимитам. Расходы включают все категории, в том числе без лимита.";
    const warning = byId("overview-budget-warning");
    warning.textContent = remainingTotal !== null && remainingTotal < 0n ? `Перерасход бюджета: ${money(-remainingTotal)}` : "";
    warning.hidden = !warning.textContent;
    const fragment = document.createDocumentFragment();
    categories.forEach((category, index) => {
      const row = document.createElement("section");
      row.className = "overview-budget-category";
      const heading = document.createElement("h3");
      heading.id = `overview-category-${index}`;
      heading.textContent = category;
      row.setAttribute("aria-labelledby", heading.id);
      const limit = budgetsReadable ? budgets[month]?.[category] : undefined;
      const spent = spentByCategory.get(category);
      const remaining = storageReadable && limit !== undefined ? BigInt(limit) - spent : null;
      const details = document.createElement("dl");
      details.className = "overview-category-values";
      const values = [
        ["Потрачено", storageReadable ? money(spent) : "—"],
        ["Лимит", !budgetsReadable ? "—" : limit === undefined ? "Не задан" : money(limit)],
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
      track.hidden = !storageReadable || limit === undefined;
      const fill = document.createElement("div");
      fill.className = remaining !== null && remaining < 0n ? "budget-fill is-over-budget" : "budget-fill";
      // Divide as integers first: only the bounded display percentage becomes a Number.
      const ratio = limit !== undefined ? spent * 10000n / BigInt(limit) : 0n;
      fill.style.width = `${Number(ratio > 10000n ? 10000n : ratio) / 100}%`;
      track.append(fill);
      const categoryWarning = document.createElement("p");
      categoryWarning.className = "overview-category-warning";
      categoryWarning.textContent = remaining !== null && remaining < 0n ? `Перерасход: ${money(-remaining)}` : "";
      categoryWarning.hidden = !categoryWarning.textContent;
      row.append(heading, details, track, categoryWarning);
      fragment.append(row);
    });
    byId("overview-budget-categories").replaceChildren(fragment);
  }

  function load() {
    selectedExpense = null;
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(saved) || !saved.every((item) => item && Number.isSafeInteger(item.amount) && item.amount > 0 && savedCategories.includes(item.category) && validDate(item.date) && typeof item.comment === "string")) {
        throw new Error("Invalid saved data");
      }
      const updated = saved.filter((item) => !removedCategories.includes(item.category))
        .map((item) => item.category === "Еда" ? { ...item, category: "Продукты" } : item);
      if (saved.some((item) => item.category === "Еда" || removedCategories.includes(item.category))) {
        const serialized = JSON.stringify(updated);
        localStorage.setItem(STORAGE_KEY, serialized);
        raw = serialized;
      }
      expenses = updated;
      savedSnapshot = raw;
      storageReadable = true;
      storageError("");
    } catch {
      storageReadable = false;
      storageError("Не удалось прочитать или обновить сохранённые траты. Добавление и удаление приостановлены, чтобы не потерять данные. Попробуйте обновить страницу.");
    }
  }

  function render(resetBudgetInputs = false) {
    const now = new Date();
    renderObligations();
    renderIncomes();
    renderSavings(now);
    if (!dateEdited) byId("date").value = localDate(now);
    // Focus listeners pass an event; only an explicit true resets clean inputs.
    renderBudget(now, resetBudgetInputs === true);
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
      name.textContent = category;
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
    if (renderedStorageReadable === storageReadable && renderedSelection === selectedExpense &&
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
      radio.setAttribute("aria-label", `Выбрать трату: ${item.category}, ${money(item.amount)}, ${displayDate(item.date)}, запись ${expenses.indexOf(item) + 1}`);
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
      category.textContent = item.category;
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
  }

  async function changeExpenses(action) {
    if (expenseWritePending) return;
    expenseWritePending = true;
    try {
      if (typeof navigator !== "undefined" && navigator.locks?.request) {
        await navigator.locks.request(STORAGE_KEY, action);
      } else {
        action();
      }
    } catch {
      storageError("Не удалось обновить траты. Поля сохранены, попробуйте снова.");
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
    fieldError("category", categories.includes(category) ? "" : "Выберите категорию из списка.");
    fieldError("date", validDate(date) ? "" : "Укажите корректную дату.");
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    const enteredAmount = byId("amount").value;
    const enteredComment = byId("comment").value;
    changeExpenses(() => {
      // Read inside the lock: a storage event from another tab may still be queued.
      load();
      if (!storageReadable) { render(); return; }
      const next = [{ amount, category, date, comment: enteredComment.trim() }, ...expenses];
      const serialized = JSON.stringify(next);
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        storageError("Не удалось сохранить трату. Проверьте доступ к хранилищу браузера и попробуйте снова. Поля сохранены в форме.");
        render();
        return;
      }
      expenses = next;
      savedSnapshot = serialized;
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
      if (localStorage.getItem(STORAGE_KEY) === savedSnapshot) return true;
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
    if (!window.confirm(`Удалить трату?\n${money(target.amount)} · ${target.category}\n${displayDate(target.date)}${comment}\n\nВосстановить запись после удаления нельзя.`)) return;
    changeExpenses(() => {
      if (!deletionDataIsCurrent() || selectedExpense !== target) return;
      const next = expenses.filter((item) => item !== target);
      const serialized = JSON.stringify(next);
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        storageError("Не удалось сохранить удаление. Трата осталась в списке. Попробуйте снова.");
        return;
      }
      expenses = next;
      savedSnapshot = serialized;
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
    if (event.key !== BUDGET_KEY && event.key !== STORAGE_KEY && event.key !== SAVINGS_KEY && event.key !== null) return;
    if (event.key === SAVINGS_KEY || event.key === null) {
      loadSavings();
      byId("goal-status").textContent = "";
    }
    if (event.key === BUDGET_KEY || event.key === null) {
      loadBudgets();
    }
    if (event.key === STORAGE_KEY || event.key === null) {
      load();
      byId("delete-status").textContent = "";
    }
    render(event.key === BUDGET_KEY || event.key === null);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== OBLIGATION_KEY && event.key !== null) return;
    loadObligations();
    byId("obligation-status").textContent = "";
    renderObligations();
  });
  window.addEventListener("focus", () => { loadObligations(); loadIncomes(); loadSavings(); render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { loadObligations(); loadIncomes(); loadSavings(); render(); }
  });
  setInterval(render, 60000);
  byId("date").value = localDate();
  byId("income-date").value = localDate();
  loadObligations();
  loadIncomes();
  load();
  loadSavings();
  render();
})();
