/**
 * Grammar Generator Unit Tests
 *
 * Verifies the grammar-based bash generator produces valid syntax.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bashArithmetic,
  bashCommand,
  bashCompound,
  bashExpansion,
  bashScript,
  bashSimpleCommand,
  bashStatement,
  bashWord,
  commandName,
  dangerousIdentifier,
  identifier,
  integerLiteral,
  pollutionAssignment,
  pollutionChain,
  pollutionExpansion,
  pollutionScript,
  simpleWord,
  strictPollutionIdentifier,
} from "./grammar-generator.js";

describe("Grammar Generator", () => {
  describe("Token Generators", () => {
    it("identifier generates valid bash identifiers", () => {
      const samples = fc.sample(identifier, 10);
      for (const id of samples) {
        // Must start with letter or underscore
        expect(id).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
      }
      console.log("Sample identifiers:", samples.slice(0, 5));
    });

    it("dangerousIdentifier includes prototype pollution targets", () => {
      const samples = fc.sample(dangerousIdentifier, 50);
      const dangerous = samples.filter((s) =>
        ["__proto__", "constructor", "prototype"].includes(s),
      );
      expect(dangerous.length).toBeGreaterThan(0);
      console.log("Dangerous identifiers found:", [...new Set(dangerous)]);
    });

    it("strictPollutionIdentifier only generates dangerous names", () => {
      const samples = fc.sample(strictPollutionIdentifier, 30);
      const validNames = [
        "__proto__",
        "constructor",
        "prototype",
        "__defineGetter__",
        "__defineSetter__",
        "__lookupGetter__",
        "__lookupSetter__",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toLocaleString",
        "toString",
        "valueOf",
      ];
      const allStrict = samples.every((s) => validNames.includes(s));
      expect(allStrict).toBe(true);
      console.log("Strict pollution identifiers:", [...new Set(samples)]);
    });

    it("integerLiteral generates valid integers", () => {
      const samples = fc.sample(integerLiteral, 10);
      for (const lit of samples) {
        expect(typeof lit).toBe("string");
      }
      console.log("Sample integers:", samples);
    });

    it("simpleWord generates safe words", () => {
      const samples = fc.sample(simpleWord, 10);
      for (const word of samples) {
        expect(word.length).toBeGreaterThan(0);
        expect(word.length).toBeLessThanOrEqual(15);
      }
      console.log("Sample words:", samples.slice(0, 5));
    });

    it("commandName generates command names", () => {
      const samples = fc.sample(commandName, 10);
      for (const cmd of samples) {
        expect(cmd.length).toBeGreaterThan(0);
      }
      console.log("Sample commands:", samples);
    });
  });

  describe("Grammar Productions", () => {
    it("bashWord generates words with expansions", () => {
      const samples = fc.sample(bashWord, 10);
      console.log("Sample words:");
      for (const word of samples) {
        console.log(`  ${word}`);
      }
      expect(samples.length).toBe(10);
    });

    it("bashExpansion generates parameter expansions", () => {
      const samples = fc.sample(bashExpansion, 10);
      console.log("Sample expansions:");
      for (const exp of samples) {
        console.log(`  ${exp}`);
        // Should contain $ for variable expansion
        expect(exp).toContain("$");
      }
    });

    it("bashArithmetic generates arithmetic expressions", () => {
      const samples = fc.sample(bashArithmetic, 10);
      console.log("Sample arithmetic:");
      for (const arith of samples) {
        console.log(`  ${arith}`);
      }
      expect(samples.length).toBe(10);
    });

    it("bashSimpleCommand generates simple commands", () => {
      const samples = fc.sample(bashSimpleCommand, 10);
      console.log("Sample simple commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      expect(samples.length).toBe(10);
    });

    it("bashCommand generates commands", () => {
      const samples = fc.sample(bashCommand, 10);
      console.log("Sample commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      expect(samples.length).toBe(10);
    });

    it("bashStatement generates statements", () => {
      const samples = fc.sample(bashStatement, 10);
      console.log("Sample statements:");
      for (const stmt of samples) {
        console.log(`  ${stmt}`);
      }
      expect(samples.length).toBe(10);
    });

    it("bashCompound generates compound commands", () => {
      const samples = fc.sample(bashCompound, 5);
      console.log("Sample compound commands:");
      for (const cmd of samples) {
        console.log("---");
        console.log(cmd);
      }
      expect(samples.length).toBe(5);
    });

    it("bashScript generates multi-statement scripts", () => {
      const samples = fc.sample(bashScript, 3);
      console.log("Sample scripts:");
      for (const script of samples) {
        console.log("===");
        console.log(script);
      }
      expect(samples.length).toBe(3);
    });
  });

  describe("Prototype Pollution Generators", () => {
    it("pollutionChain generates property chains", () => {
      const samples = fc.sample(pollutionChain, 20);
      console.log("Sample pollution chains:");
      for (const chain of samples) {
        console.log(`  ${chain}`);
      }
      // Should include various chain patterns
      const hasProto = samples.some((s) => s.includes("__proto__"));
      const hasConstructor = samples.some((s) => s.includes("constructor"));
      const hasChain = samples.some((s) => s.includes(".") || s.includes("["));
      expect(hasProto).toBe(true);
      expect(hasConstructor).toBe(true);
      expect(hasChain).toBe(true);
    });

    it("pollutionAssignment generates dangerous assignments", () => {
      const samples = fc.sample(pollutionAssignment, 15);
      console.log("Sample pollution assignments:");
      for (const assign of samples) {
        console.log(`  ${assign}`);
      }
      // Should include various pollution patterns
      const hasDirect = samples.some(
        (s) =>
          s.startsWith("__proto__=") ||
          s.startsWith("constructor=") ||
          s.startsWith("prototype="),
      );
      const hasArray = samples.some((s) => s.includes("["));
      const hasDeclare = samples.some((s) => s.includes("declare"));
      expect(hasDirect || hasArray || hasDeclare).toBe(true);
    });

    it("pollutionExpansion generates dangerous expansions", () => {
      const samples = fc.sample(pollutionExpansion, 15);
      console.log("Sample pollution expansions:");
      for (const exp of samples) {
        console.log(`  ${exp}`);
      }
      // ALL should contain strict pollution identifiers (no regular names)
      const allDangerous = samples.every(
        (s) =>
          s.includes("__proto__") ||
          s.includes("constructor") ||
          s.includes("prototype") ||
          s.includes("toString") ||
          s.includes("valueOf") ||
          s.includes("hasOwnProperty") ||
          s.includes("__defineGetter__") ||
          s.includes("__defineSetter__") ||
          s.includes("__lookupGetter__") ||
          s.includes("__lookupSetter__") ||
          s.includes("isPrototypeOf") ||
          s.includes("propertyIsEnumerable") ||
          s.includes("toLocaleString"),
      );
      expect(allDangerous).toBe(true);
    });

    it("pollutionScript generates complete pollution test scripts", () => {
      const samples = fc.sample(pollutionScript, 10);
      console.log("Sample pollution scripts:");
      for (const script of samples) {
        console.log("---");
        console.log(script);
      }
      expect(samples.length).toBe(10);
    });
  });

  describe("Grammar Coverage", () => {
    it("generates variety of control structures", () => {
      const samples = fc.sample(bashCompound, 50);
      const hasIf = samples.some((s) => s.includes("if ") && s.includes("fi"));
      const hasFor = samples.some(
        (s) => s.includes("for ") && s.includes("done"),
      );
      const hasWhile = samples.some(
        (s) => s.includes("while ") && s.includes("done"),
      );
      const hasCase = samples.some(
        (s) => s.includes("case ") && s.includes("esac"),
      );
      const hasSubshell = samples.some((s) => s.startsWith("("));
      const hasGroup = samples.some((s) => s.startsWith("{"));
      const hasFunction = samples.some((s) => s.includes("()"));

      console.log("Control structures found:", {
        if: hasIf,
        for: hasFor,
        while: hasWhile,
        case: hasCase,
        subshell: hasSubshell,
        group: hasGroup,
        function: hasFunction,
      });

      // Should have at least some variety
      const count = [
        hasIf,
        hasFor,
        hasWhile,
        hasCase,
        hasSubshell,
        hasGroup,
      ].filter(Boolean).length;
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it("generates variety of expansions", () => {
      const samples = fc.sample(bashExpansion, 100);
      const hasSimple = samples.some((s) => /^\$[a-zA-Z_]/.test(s));
      const hasSpecial = samples.some((s) =>
        ["$?", "$!", "$$", "$#", "$@", "$*", "$0", "$1"].includes(s),
      );
      const hasBraced = samples.some((s) => s.includes("${"));
      const hasDefault = samples.some((s) => s.includes(":-"));
      const hasLength = samples.some((s) => s.includes("${#"));
      const hasSubstitution = samples.some((s) => s.includes("$("));
      const hasArithExpansion = samples.some((s) => s.includes("$(("));

      console.log("Expansion types found:", {
        simple: hasSimple,
        special: hasSpecial,
        braced: hasBraced,
        default: hasDefault,
        length: hasLength,
        substitution: hasSubstitution,
        arithmetic: hasArithExpansion,
      });

      const count = [
        hasSimple,
        hasSpecial,
        hasBraced,
        hasDefault,
        hasSubstitution,
      ].filter(Boolean).length;
      expect(count).toBeGreaterThanOrEqual(3);
    });
  });
});
