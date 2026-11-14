import { test } from "node:test";
import assert from "node:assert/strict";
import { emailInputError, imageHeaderError, mobileInputError, normalizePhilippineMobile, parseDecimal, parseReportCoordinates, passwordInputError, reportSchema, textInputError, residentNamePartsError, residentDisplayName, residentAgeError, characterLimitHint, SHORT_REASON_LIMIT } from "../shared/index";

test("decimal coordinates reject implicit conversions and non-finite inputs", () => {
  for (const value of ["", " ", null, undefined, true, false, [], {}, "0x8", "0b10", "1e999", "9".repeat(1000), "NaN", "Infinity", Infinity, NaN]) assert.ok(Number.isNaN(parseDecimal(value)));
  for (const value of ["0x8", "1e2", "", " ", "Infinity"]) assert.equal(parseReportCoordinates(value, "124.2"), null);
  assert.equal(parseDecimal(" -8.250 "), -8.25);
  assert.equal(parseDecimal(".25"), .25);
  assert.equal(parseDecimal(0), 0);
});
test("report schema rejects blank coordinates, control text and invisible-only descriptions", () => {
  const valid = { category_id: "ed50652a-ce04-4a3d-97c0-bb7837cd2893", barangay_id: "5c5cd6d8-1af8-4c17-bdd5-2065176644d6", title: "Pothole near the crossing", description: "Please inspect the road near the crossing.", latitude: 8.2, longitude: 124.2 };
  for (const latitude of ["", " ", null, false, "0x8", Infinity]) assert.equal(reportSchema.safeParse({ ...valid, latitude }).success, false);
  for (const description of [" ".repeat(20), "\u200b".repeat(20), "A valid explanation\u0001 with a control character", "x".repeat(4001)]) assert.equal(reportSchema.safeParse({ ...valid, description }).success, false);
  assert.equal(reportSchema.safeParse({ ...valid, landmark: "x".repeat(241) }).success, false);
});
test("text validation preserves multilingual, punctuated and literal markup input", () => {
  for (const value of ["O'Connor — Straße", "Ayaw paglabay og basura.", "日本語の説明 👩‍🔧", "<script>alert('text only')</script>", "Robert'); DROP TABLE reports;--", "Line one\nLine two\twith context"]) assert.equal(textInputError(value, { min: 2, max: 200, required: true }), "");
  assert.ok(textInputError("\u200b\u200d", { required: true }));
  assert.ok(textInputError("abc\u0000def"));
  assert.ok(textInputError("   ", { required: true }));
  assert.ok(textInputError(" short ", { min: 8 }));
  assert.equal(textInputError("", { max: 240 }), "");
});
test("resident name parts compose a bounded full name and allow a blank middle name", () => {
  assert.equal(residentNamePartsError("  Ana  ", "", "Cruz"), "");
  assert.equal(residentNamePartsError("Maria", "Santos", "Dela Cruz"), "");
  assert.equal(residentDisplayName(" Ana ", "  ", "Cruz "), "Ana Cruz");
  assert.ok(residentNamePartsError("", "", "Cruz"));
  assert.ok(residentNamePartsError("Ana", "", ""));
  assert.ok(residentNamePartsError("a".repeat(60), "b".repeat(40), "c"));
  assert.ok(residentNamePartsError("a".repeat(61), "", "Cruz"));
});
test("resident age accepts whole years from 1 through 120", () => {
  assert.equal(residentAgeError("1", true), "");
  assert.equal(residentAgeError("120", true), "");
  assert.ok(residentAgeError("", true));
  assert.equal(residentAgeError("", false), "");
  for (const value of ["0", "121", "2.5", "-1", "abc"]) assert.ok(residentAgeError(value));
});
test("input bounds include exact limits and do not silently trim passwords", () => {
  assert.equal(textInputError("x".repeat(160), { min: 8, max: 160 }), "");
  assert.ok(textInputError("x".repeat(161), { max: 160 }));
  assert.equal(passwordInputError(" a long password phrase ", 12), "");
  assert.ok(passwordInputError("short", 12));
  assert.ok(passwordInputError("x".repeat(1025)));
});
test("email preflight rejects malformed addresses before auth or recovery requests", () => {
  for (const email of ["", "name", "name@", "name@example", "a b@example.com", "a\n@example.com", "a\u0000@example.com", "a\u200b@example.com", "x".repeat(255)+"@example.com"]) assert.ok(emailInputError(email));
  assert.equal(emailInputError(" name+tag@example.com "), "");
});
test("Philippine mobile numbers normalize to one database format", () => {
  for (const value of ["0917 123 4567", "9171234567", "+63 917 123 4567", "639171234567", "(0917) 123-4567"]) {
    assert.equal(normalizePhilippineMobile(value), "+639171234567");
    assert.equal(mobileInputError(value), "");
  }
  for (const value of ["0917 123 456", "0817 123 4567", "+1 917 123 4567", "0917abc4567"]) {
    assert.equal(normalizePhilippineMobile(value), null);
    assert.ok(mobileInputError(value));
  }
  assert.equal(normalizePhilippineMobile(""), "");
  assert.equal(mobileInputError(""), "");
  assert.ok(mobileInputError("", true));
});
test("image signatures reject disguised, empty and mismatched uploads", () => {
  const jpeg = new Uint8Array([255,216,255,224]);
  const png = new Uint8Array([137,80,78,71,13,10,26,10]);
  assert.equal(imageHeaderError(jpeg,"image/jpeg"), "");
  assert.equal(imageHeaderError(png,"image/png"), "");
  assert.ok(imageHeaderError(new TextEncoder().encode('<script>not an image</script>'),"image/png"));
  assert.ok(imageHeaderError(new Uint8Array(),"image/jpeg"));
  assert.ok(imageHeaderError(jpeg,"image/png"));
  assert.ok(imageHeaderError(jpeg,"text/plain"));
});

test("character guidance stays quiet until close to the limit", () => {
  assert.equal(SHORT_REASON_LIMIT, 500);
  assert.equal(characterLimitHint(0, 500), "");
  assert.equal(characterLimitHint(399, 500), "");
  assert.equal(characterLimitHint(400, 500), "100 characters left");
  assert.equal(characterLimitHint(499, 500), "1 character left");
  assert.equal(characterLimitHint(500, 500), "Character limit reached");
  assert.equal(characterLimitHint(501, 500), "1 character over the limit");
  assert.equal(characterLimitHint(1600, 2000), "400 characters left");
  assert.equal(textInputError("x".repeat(500), { min: 5, max: SHORT_REASON_LIMIT }), "");
  assert.ok(textInputError("x".repeat(501), { min: 5, max: SHORT_REASON_LIMIT }));
});
