"use client";
import { useEffect } from "react";
import { emailInputError, passwordInputError, textInputError } from "@community/shared";

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
      field.setCustomValidity("");
      let message = "";
      const secret = field instanceof HTMLInputElement && (field.type === "password" || field.autocomplete.includes("password"));
      if (secret && (field.required || field.value)) message = passwordInputError(field.value, Math.max(1, field.minLength));
      if (secret && field.maxLength >= 0 && field.value.length > field.maxLength) message = `Use no more than ${field.maxLength} characters.`;
      if (!(field instanceof HTMLSelectElement) && !secret && ["text", "search", "email", "url", "tel", "textarea"].includes(field.type)) {
        message = textInputError(field.value, { required: field.required, min: Math.max(0, field.minLength), max: field.maxLength < 0 ? Infinity : field.maxLength });
      }
      if (field instanceof HTMLInputElement && field.type === "email" && field.value && !message) message = emailInputError(field.value);
      if (field instanceof HTMLInputElement && field.type.startsWith("date") && field.value) {
        const date = new Date(field.value);
        if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) message = "Choose a valid date with a year from 0001 to 9999.";
      }
      if (field.name === "closes" && field.form) {
        const opening = field.form.elements.namedItem("opens");
        if (opening instanceof HTMLInputElement && field.value && opening.value && Date.parse(field.value) <= Date.parse(opening.value)) message = "Closing time must be later than opening time.";
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
      if (event.target.dataset.validationError) validate(event.target);
      if (event.target.name === "password") {
        const confirmation = event.target.form?.elements.namedItem("confirm");
        if (confirmation instanceof HTMLInputElement && confirmation.dataset.validationError) validate(confirmation);
      }
      if (event.target.name === "opens") {
        const closing = event.target.form?.elements.namedItem("closes");
        if (closing instanceof HTMLInputElement && closing.dataset.validationError) validate(closing);
      }
    };
    const blur = (event: Event) => { if (isControl(event.target) && event.target.form) validate(event.target); };
    const reset = (event: Event) => { if (event.target instanceof HTMLFormElement) Array.from(event.target.elements).filter(isControl).forEach(field => mark(field, "")); };
    for (const [type, handler] of [["submit", submit], ["invalid", invalid], ["input", input], ["change", input], ["blur", blur], ["reset", reset]] as const) document.addEventListener(type, handler, true);
    return () => { for (const [type, handler] of [["submit", submit], ["invalid", invalid], ["input", input], ["change", input], ["blur", blur], ["reset", reset]] as const) document.removeEventListener(type, handler, true); };
  }, []);
  return null;
}
