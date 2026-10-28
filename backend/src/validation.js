const net = require("net");
const url = require("url");

// Field checks that give the same messages and the same {"field": ["message"]} error shape
// as the Django REST framework serializers did, so the React app shows them unchanged.

/** One field failed. detail is a message, or an object of nested field errors. */
class FieldError extends Error {
  constructor(detail) {
    super(typeof detail === "string" ? detail : "Invalid input.");
    this.detail = typeof detail === "string" ? [detail] : detail;
  }
}

/** The request failed validation, sent back as a 400 with errors as the body. */
class ValidationError extends Error {
  constructor(errors) {
    super("Invalid input.");
    this.errors = errors;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pyTypeName(value) {
  if (value === null || value === undefined) return "NoneType";
  if (Array.isArray(value)) return "list";
  if (typeof value === "string") return "str";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  return "dict";
}

/**
 * Checks data against fields, {name: {clean, required, requiredMessage, default}}.
 * clean(value) returns the cleaned value or throws FieldError, it may be async.
 * With partial, missing fields are left out, as on a PATCH.
 */
async function validate(data, fields, { partial = false } = {}) {
  const values = {};
  const errors = {};
  for (const [name, field] of Object.entries(fields)) {
    const value = data[name];
    if (value === undefined) {
      if (partial) continue;
      if (field.required) errors[name] = [field.requiredMessage || "This field is required."];
      else if ("default" in field) values[name] = field.default;
      continue;
    }
    try {
      values[name] = await field.clean(value);
    } catch (err) {
      if (!(err instanceof FieldError)) throw err;
      errors[name] = err.detail;
    }
  }
  return { values, errors: Object.keys(errors).length ? errors : null };
}

function string(value, { maxLength = 255, allowBlank = false, allowNull = false, blankMessage } = {}) {
  if (value === null) {
    if (allowNull) return null;
    throw new FieldError("This field may not be null.");
  }
  if (typeof value !== "string" && typeof value !== "number") throw new FieldError("Not a valid string.");
  const text = String(value).trim();
  if (text === "") {
    if (allowBlank) return "";
    throw new FieldError(blankMessage || "This field may not be blank.");
  }
  if (Array.from(text).length > maxLength) {
    throw new FieldError(`Ensure this field has no more than ${maxLength} characters.`);
  }
  return text;
}

// Django's EmailValidator rules.
const EMAIL_USER = /^(?:[-!#$%&'*+/=?^_`{}|~0-9A-Z]+(?:\.[-!#$%&'*+/=?^_`{}|~0-9A-Z]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f!#-[\]-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")$/i;
const EMAIL_DOMAIN = /^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z0-9-]{2,63}(?<!-)$/i;

function isEmail(text) {
  if (!text || !text.includes("@") || text.length > 320) return false;
  const at = text.lastIndexOf("@");
  const user = text.slice(0, at);
  const domain = text.slice(at + 1);
  if (!EMAIL_USER.test(user)) return false;
  if (domain === "localhost" || EMAIL_DOMAIN.test(domain)) return true;
  const literal = /^\[([A-F0-9:.]+)\]$/i.exec(domain);
  if (literal) return net.isIP(literal[1]) !== 0;
  const ascii = url.domainToASCII(domain);
  return Boolean(ascii) && ascii !== domain && EMAIL_DOMAIN.test(ascii);
}

function email(value, options = {}) {
  const text = string(value, options);
  if (text && !isEmail(text)) throw new FieldError("Enter a valid email address.");
  return text;
}

function integer(value, { min, max } = {}) {
  if (value === null) throw new FieldError("This field may not be null.");
  let number = null;
  if (typeof value === "number" || typeof value === "string") {
    const text = String(value).trim().replace(/\.0*\s*$/, "");
    if (/^[+-]?\d+$/.test(text)) number = Number(text);
  }
  if (number === null || !Number.isSafeInteger(number)) throw new FieldError("A valid integer is required.");
  if (max !== undefined && number > max) throw new FieldError(`Ensure this value is less than or equal to ${max}.`);
  if (min !== undefined && number < min) throw new FieldError(`Ensure this value is greater than or equal to ${min}.`);
  return number;
}

function choice(value, choices) {
  if (value === null) throw new FieldError("This field may not be null.");
  const text = String(value);
  if (!choices.includes(text)) throw new FieldError(`"${text}" is not a valid choice.`);
  return text;
}

function dict(value, { allowEmpty = true } = {}) {
  if (value === null) throw new FieldError("This field may not be null.");
  if (!isPlainObject(value)) throw new FieldError(`Expected a dictionary of items but got type "${pyTypeName(value)}".`);
  if (!allowEmpty && Object.keys(value).length === 0) throw new FieldError("This dictionary may not be empty.");
  return value;
}

/** A nested object of fields, errors come back nested under the field name. */
async function nested(value, fields) {
  if (value === null) throw new FieldError("This field may not be null.");
  if (!isPlainObject(value)) {
    throw new FieldError({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(value)}.`] });
  }
  const { values, errors } = await validate(value, fields);
  if (errors) throw new FieldError(errors);
  return values;
}

module.exports = {
  FieldError,
  ValidationError,
  isPlainObject,
  pyTypeName,
  validate,
  string,
  email,
  integer,
  choice,
  dict,
  nested,
};
