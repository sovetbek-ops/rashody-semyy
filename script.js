"use strict";

(() => {
  const STORAGE_KEY = "family-expenses-v1";
  const categories = ["Еда", "Транспорт", "Дом", "Другое", "Кредит", "Ипотека", "Расходы на секцию ребёнка"];
  const byId = (id) => document.getElementById(id);
  const form = byId("expense-form");
  const start = byId("period-start");
  const end = byId("period-end");
  let expenses = [];
  let storageReadable = true;
  let selectedExpense = null;
  let savedSnapshot = null;

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

  function load() {
    selectedExpense = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(saved) || !saved.every((item) => item && Number.isSafeInteger(item.amount) && item.amount > 0 && categories.includes(item.category) && validDate(item.date) && typeof item.comment === "string")) {
        throw new Error("Invalid saved data");
      }
      expenses = saved;
      savedSnapshot = raw;
      storageReadable = true;
      storageError("");
    } catch {
      storageReadable = false;
      storageError("Не удалось прочитать сохранённые траты. Добавление и удаление приостановлены, чтобы не потерять данные. Попробуйте обновить страницу.");
    }
  }

  function render() {
    const now = new Date();
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
    selectedExpense = null;
    byId("delete-status").textContent = "";
    document.querySelectorAll("[data-period]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === period)));
  }

  document.querySelectorAll("[data-period]").forEach((button) => {
    button.addEventListener("click", () => {
      const period = button.dataset.period;
      const today = new Date();
      if (period === "all") { start.value = ""; end.value = ""; }
      else {
        end.value = localDate(today);
        if (period === "month") {
          start.value = `${localDate(today).slice(0, 7)}-01`;
          end.value = localDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
        } else {
          today.setDate(today.getDate() - Number(period) + 1);
          start.value = localDate(today);
        }
      }
      markPeriod(period);
      render();
    });
  });
  [start, end].forEach((input) => input.addEventListener("input", () => { markPeriod(""); render(); }));
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      load();
      byId("delete-status").textContent = "";
      render();
    }
  });
  window.addEventListener("focus", render);
  setInterval(render, 60000);
  byId("date").value = localDate();
  load();
  render();
})();
