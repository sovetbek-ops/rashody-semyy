"use strict";

(() => {
  const STORAGE_KEY = "family-expenses-v1";
  const BUDGET_KEY = "family-budgets-v1";
  const categories = ["Продукты", "Транспорт", "Кредит", "Ипотека", "Расходы на секцию ребёнка"];
  const removedCategories = ["Дом", "Другое"];
  const savedCategories = [...categories, "Еда", ...removedCategories];
  const byId = (id) => document.getElementById(id);
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
      renderBudget(now);
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
      renderBudget(now);
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
    renderBudget(now);
    status.textContent = remove ? "Лимит убран" : "Лимит сохранён";
  }

  function renderBudget(now, resetInputs = false) {
    const month = localDate(now).slice(0, 7);
    if (month !== budgetMonth) {
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
      if (resetInputs) {
        byId(`budget-${index}`).value = budgetsReadable && amount !== undefined ? String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "";
        fieldError(`budget-${index}`, "");
        byId(`budget-status-${index}`).textContent = "";
      }
    });
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

  function render() {
    const now = new Date();
    renderBudget(now);
    updateQuickPeriod(now);
    const month = localDate(now).slice(0, 7);
    byId("month-label").textContent = now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    byId("month-total").textContent = money(total(expenses.filter((item) => item.date.startsWith(`${month}-`))));
    const invalidPeriod = (start.value && !validDate(start.value)) || (end.value && !validDate(end.value)) || (start.value && end.value && start.value > end.value);
    byId("period-error").textContent = invalidPeriod ? "Проверьте период: дата «С» должна быть не позже даты «По»." : "";
    byId("period-error").hidden = !invalidPeriod;
    start.setAttribute("aria-invalid", String(Boolean(invalidPeriod)));
    end.setAttribute("aria-invalid", String(Boolean(invalidPeriod)));
    const visible = invalidPeriod ? [] : expenses.filter((item) => (!start.value || item.date >= start.value) && (!end.value || item.date <= end.value));
    if (!visible.includes(selectedExpense)) selectedExpense = null;
    byId("delete-expense").disabled = !selectedExpense || !storageReadable;
    byId("period-total").textContent = invalidPeriod ? "—" : money(total(visible));
    const categoryTotals = new Map(categories.map((category) => [category, 0n]));
    visible.forEach((item) => categoryTotals.set(item.category, categoryTotals.get(item.category) + BigInt(item.amount)));
    const categoryFragment = document.createDocumentFragment();
    categories.forEach((category) => {
      const row = document.createElement("div");
      const name = document.createElement("dt");
      name.textContent = category;
      const amount = document.createElement("dd");
      amount.textContent = invalidPeriod ? "—" : money(categoryTotals.get(category));
      row.append(name, amount);
      categoryFragment.append(row);
    });
    byId("category-totals").replaceChildren(categoryFragment);
    byId("expense-count").textContent = `Записей: ${visible.length}`;
    byId("empty-state").hidden = visible.length > 0 || Boolean(invalidPeriod);
    byId("empty-state").textContent = expenses.length ? "За этот период трат нет" : "Пока нет трат";
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
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    byId("save-status").textContent = "";
    const amount = parseAmount(byId("amount").value);
    const category = byId("category").value;
    const date = byId("date").value;
    fieldError("amount", amount === null ? "Введите положительную целую сумму в тенге, например 5 000." : "");
    fieldError("category", categories.includes(category) ? "" : "Выберите категорию из списка.");
    fieldError("date", validDate(date) ? "" : "Укажите корректную дату.");
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    if (!storageReadable) { load(); if (!storageReadable) return; }
    const next = [{ amount, category, date, comment: byId("comment").value.trim() }, ...expenses];
    const serialized = JSON.stringify(next);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      storageError("Не удалось сохранить трату. Проверьте доступ к хранилищу браузера и попробуйте снова. Поля сохранены в форме.");
      return;
    }
    expenses = next;
    savedSnapshot = serialized;
    selectedExpense = null;
    byId("delete-status").textContent = "";
    storageError("");
    byId("amount").value = "";
    byId("comment").value = "";
    render();
    byId("save-status").textContent = "Трата добавлена";
    byId("amount").focus();
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
    const target = selectedExpense;
    byId("delete-status").textContent = "";
    if (!storageReadable || !target || !expenses.includes(target) || !deletionDataIsCurrent()) return;
    const comment = target.comment ? `\n${target.comment}` : "";
    if (!window.confirm(`Удалить трату?\n${money(target.amount)} · ${target.category}\n${displayDate(target.date)}${comment}\n\nВосстановить запись после удаления нельзя.`)) return;
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
  window.addEventListener("storage", (event) => {
    if (event.key === BUDGET_KEY || event.key === null) {
      loadBudgets();
      renderBudget(new Date(), true);
    }
    if (event.key === STORAGE_KEY || event.key === null) {
      load();
      byId("delete-status").textContent = "";
      render();
    }
  });
  window.addEventListener("focus", render);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });
  setInterval(render, 60000);
  byId("date").value = localDate();
  load();
  render();
})();
