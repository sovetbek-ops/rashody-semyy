"use strict";

(() => {
  const STORAGE_KEY = "family-expenses-v1";
  const BUDGET_KEY = "family-budgets-v1";
  const SAVINGS_KEY = "family-savings-v1";
  const categories = ["Продукты", "Транспорт", "Кредит", "Ипотека", "Расходы на секцию ребёнка"];
  const removedCategories = ["Дом", "Другое"];
  const savedCategories = [...categories, "Еда", ...removedCategories];
  const byId = (id) => document.getElementById(id);
  const views = {
    overview: ["Обзор", "Расходы семьи за текущий месяц."],
    expenses: ["Траты", "Записывайте расходы и выбирайте период просмотра."],
    budget: ["Бюджет", "Планируйте расходы и следите за лимитами месяца."],
    savings: ["Накопления", "Деньги на цели учитываются отдельно от расходов"]
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
        validDate(goal.date) && Array.isArray(goal.operations) && goal.operations.length <= 1 &&
        goal.operations.every((operation) => operation && uniqueId(operation.id) && operation.type === "initial" &&
          Number.isSafeInteger(operation.amount) && operation.amount > 0 && validDate(operation.date))
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

  function renderSavings(now) {
    goalFields.forEach((id) => { byId(id).disabled = savingsWritePending; });
    byId("create-goal").disabled = !savingsReadable || savingsWritePending;
    byId("save-goal").disabled = !savingsReadable || savingsWritePending;
    byId("cancel-goal").disabled = savingsWritePending;
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
      const balance = goal.operations.reduce((sum, operation) => sum + BigInt(operation.amount), 0n);
      const target = BigInt(goal.target);
      const remaining = balance >= target ? 0n : target - balance;
      const tenths = balance >= target ? 1000n : balance * 1000n / target;
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
        value.textContent = money(amount);
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
      fragment.append(card);
    });
    byId("goal-list").replaceChildren(fragment);
  }

  const goalFields = ["goal-name", "goal-description", "goal-target", "goal-initial", "goal-date"];
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
      const newId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16).padStart(8, "0")).join("");
      const operations = initial ? [{ id: newId(), type: "initial", amount: initial, date: localDate() }] : [];
      const goal = { id: newId(), name, description, target, date, operations };
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
  window.addEventListener("focus", () => { loadSavings(); render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { loadSavings(); render(); }
  });
  setInterval(render, 60000);
  byId("date").value = localDate();
  load();
  loadSavings();
  render();
})();
