"use client";
import { useEffect } from "react";
import { addressInputError, dateInputError, emailInputError, mobileInputError, normalizePersonName, normalizePhilippineMobile, numericInputError, passwordInputError, personNameInputError, residentAgeError, textInputError } from "@community/shared";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isControl = (value: EventTarget | null): value is Control => value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement;

export function FormValidation() {
  useEffect(() => {
    let sequence = 0;
    function mark(field: Control, message: string) {
      const previous = field.dataset.validationError;
      field.setCustomValidity(message);
      if (!message) {
        if (previous) {
          document.getElementById(previous)?.remove();
          field.setAttribute("aria-describedby", (field.getAttribute("aria-describedby") || "").split(" ").filter(id => id && id !== previous).join(" "));
          field.removeAttribute("aria-invalid");
          delete field.dataset.validationError;
        }
        return;
      }
      const id = previous || `field-error-${++sequence}`;
      let feedback = document.getElementById(id);
      if (!feedback) {
        feedback = document.createElement("p");
        feedback.id = id; feedback.className = "field-validation-message"; feedback.setAttribute("role", "alert");
        (field.closest("label") || field.parentElement)?.append(feedback);
        field.dataset.validationError = id;
        field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), id].filter(Boolean).join(" "));
      }
      field.setAttribute("aria-invalid", "true");
      if (feedback.textContent !== message) feedback.textContent = message;
    }
    function validate(field: Control) {
      if (!field.willValidate || field.disabled) return "";
      field.dataset.validationTouched = "true";
      field.setCustomValidity("");
      let message = "";
      const secret = field instanceof HTMLInputElement && (field.type === "password" || field.autocomplete.includes("password"));
      const name = `${field.name} ${field.id} ${field.autocomplete}`.toLowerCase();
      const fieldKeys = `${field.name} ${field.id}`.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
      const email = field instanceof HTMLInputElement && field.type === "email";
      const personName = !email && (/(^|[ _-])(first|middle|last|full|resident|reporter|staff|person)(_|$|-)/.test(fieldKeys)
        || ["given-name", "additional-name", "family-name", "name"].includes(field.autocomplete));
      const phone = field instanceof HTMLInputElement && (field.type === "tel" || /(^|[ _-])(phone|mobile)(_|$|-)/.test(name));
      const address = /(^|[ _-])(address|landmark|purok|zone|street|location)(_|$|-)/.test(name)
        || field.autocomplete === "street-address";
      if (secret && (field.required || field.value)) message = passwordInputError(field.value, Math.max(1, field.minLength));
      if (secret && field.maxLength >= 0 && field.value.length > field.maxLength) message = `Use no more than ${field.maxLength} characters.`;
      if (!(field instanceof HTMLSelectElement) && !secret && ["text", "search", "email", "url", "tel", "textarea"].includes(field.type)) {
        const max = field.maxLength < 0 ? Infinity : field.maxLength;
        if (personName) message = personNameInputError(field.value, field.required, max);
        else if (name.split(/[\s_-]+/).includes("age")) message = residentAgeError(field.value, field.required);
        else if (phone) message = mobileInputError(field.value, field.required);
        else if (email) message = field.value ? emailInputError(field.value) : field.required ? "Enter an email address." : "";
        else if (address) message = addressInputError(field.value, { required: field.required, min: Math.max(0, field.minLength), max });
        else message = textInputError(field.value, { required: field.required, min: Math.max(0, field.minLength), max });
      }
      if (field instanceof HTMLInputElement && field.type === "number" && field.value && !message) {
        const min = field.min ? Number(field.min) : -Infinity;
        const max = field.max ? Number(field.max) : Infinity;
        message = numericInputError(field.value, { min, max, decimal: field.step === "any" || Number(field.step) % 1 !== 0 });
      }
      if (field instanceof HTMLInputElement && field.type.startsWith("date") && field.value) {
        message = dateInputError(field.value);
        if (!message && /(birth|date_of_birth|dob)/i.test(name) && new Date(field.value).getTime() > Date.now()) message = "Birth date cannot be in the future.";
      }
      const startFieldByEnd: Record<string, string> = { closes: "opens", ends: "starts", ends_at: "starts_at", end_date: "start_date", end: "start" };
      const endField = Object.hasOwn(startFieldByEnd, field.name);
      if (endField && field.form) {
        const opening = field.form.elements.namedItem(startFieldByEnd[field.name]);
        if (opening instanceof HTMLInputElement && field.value && opening.value && Date.parse(field.value) <= Date.parse(opening.value)) message = "End date and time must be later than the start.";
      }
      if (secret && field.name === "confirm" && field.form) {
        const password = field.form.elements.namedItem("password");
        if (password instanceof HTMLInputElement && field.value && field.value !== password.value) message = "Passwords must match exactly.";
      }
      message ||= field.validationMessage;
      mark(field, message);
      return message;
    }
    const submit = (event: Event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const fields = Array.from(event.target.elements).filter(isControl);
      const invalid = fields.filter(field => validate(field));
      if (invalid.length) { event.preventDefault(); event.stopImmediatePropagation(); invalid[0].focus(); invalid[0].reportValidity(); }
    };
    const invalid = (event: Event) => { if (isControl(event.target)) validate(event.target); };
    const input = (event: Event) => {
      if (!isControl(event.target)) return;
      if (event.target.dataset.validationTouched === "true") validate(event.target);
      if (event.target.name === "password") {
        const confirmation = event.target.form?.elements.namedItem("confirm");
        if (confirmation instanceof HTMLInputElement && confirmation.dataset.validationTouched === "true") validate(confirmation);
      }
      const endFieldByStart: Record<string, string> = { opens: "closes", starts: "ends", starts_at: "ends_at", start_date: "end_date", start: "end" };
      if (Object.hasOwn(endFieldByStart, event.target.name)) {
        const closing = event.target.form?.elements.namedItem(endFieldByStart[event.target.name]);
        if (closing instanceof HTMLInputElement && closing.dataset.validationTouched === "true") validate(closing);
      }
    };
    const blur = (event: Event) => {
      if (!isControl(event.target) || !event.target.form) return;
      const field = event.target;
      const name = `${field.name} ${field.id} ${field.autocomplete}`.toLowerCase();
      const fieldKeys = `${field.name} ${field.id}`.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
      const email = field instanceof HTMLInputElement && field.type === "email";
      const personName = !email && (/(^|[ _-])(first|middle|last|full|resident|reporter|staff|person)(_|$|-)/.test(fieldKeys)
        || ["given-name", "additional-name", "family-name", "name"].includes(field.autocomplete));
      let normalized = field.value;
      if (personName) normalized = normalizePersonName(normalized);
      else if (email) normalized = normalized.trim();
      else if (field instanceof HTMLInputElement && (field.type === "tel" || /(^|[ _-])(phone|mobile)(_|$|-)/.test(name))) {
        normalized = normalizePhilippineMobile(normalized) || normalized.trim();
      }
      if (normalized !== field.value) {
        field.value = normalized;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      validate(field);
    };
    const reset = (event: Event) => {
      if (event.target instanceof HTMLFormElement) Array.from(event.target.elements).filter(isControl).forEach(field => {
        mark(field, "");
        delete field.dataset.validationTouched;
      });
    };
    for (const [type, handler] of [["submit", submit], ["invalid", invalid], ["input", input], ["change", input], ["blur", blur], ["reset", reset]] as const) document.addEventListener(type, handler, true);
    return () => { for (const [type, handler] of [["submit", submit], ["invalid", invalid], ["input", input], ["change", input], ["blur", blur], ["reset", reset]] as const) document.removeEventListener(type, handler, true); };
  }, []);
  return null;
}
