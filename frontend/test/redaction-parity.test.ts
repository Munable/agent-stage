import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  containsHiddenReasoning,
  dropPrivateKeys,
  safePublicText,
  sanitizePublicPayload,
} from "../src/sanitize";

type RedactionCase = {
  name: string;
  input: unknown;
  expected: unknown;
};

type TextCase = RedactionCase & {
  input: string;
  fallback: string;
  max_chars: number;
  expected: string;
};

type RedactionFixture = {
  payload_cases: RedactionCase[];
  text_cases: TextCase[];
  drop_private_key_cases: RedactionCase[];
  hidden_reasoning_cases: RedactionCase[];
};

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(here, "../../tests/parity/redaction_cases.json"), "utf8"),
) as RedactionFixture;

function decodeSpecialValues(value: unknown): unknown {
  if (value === "__NON_FINITE_NAN__") return Number.NaN;
  if (value === "__NON_FINITE_INFINITY__") return Number.POSITIVE_INFINITY;
  if (Array.isArray(value)) return value.map((item) => decodeSpecialValues(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decodeSpecialValues(item)]),
    );
  }
  return value;
}

describe("redaction parity", () => {
  for (const testCase of fixture.payload_cases) {
    it(`sanitizes payloads: ${testCase.name}`, () => {
      expect(sanitizePublicPayload(decodeSpecialValues(testCase.input))).toEqual(
        testCase.expected,
      );
    });
  }

  for (const testCase of fixture.text_cases) {
    it(`sanitizes public text: ${testCase.name}`, () => {
      expect(
        safePublicText(testCase.input, {
          fallback: testCase.fallback,
          maxChars: testCase.max_chars,
        }),
      ).toBe(testCase.expected);
    });
  }

  for (const testCase of fixture.drop_private_key_cases) {
    it(`drops private keys: ${testCase.name}`, () => {
      expect(dropPrivateKeys(testCase.input)).toEqual(testCase.expected);
    });
  }

  for (const testCase of fixture.hidden_reasoning_cases) {
    it(`detects hidden reasoning: ${testCase.name}`, () => {
      expect(containsHiddenReasoning(testCase.input)).toBe(testCase.expected);
    });
  }
});
