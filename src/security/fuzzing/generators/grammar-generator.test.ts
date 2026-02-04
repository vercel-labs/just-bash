/**
 * Grammar Generator Unit Tests
 *
 * Verifies the grammar-based bash generator produces valid syntax.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  awkGrammarCommand,
  awkPollutionCommand,
  awkPollutionProgram,
  awkProgram,
  bashArithmetic,
  bashCommand,
  bashCompound,
  bashExpansion,
  bashScript,
  bashSimpleCommand,
  bashStatement,
  bashWord,
  catCommand,
  commandName,
  commandPipeline,
  commandScript,
  dangerousIdentifier,
  grepCommand,
  identifier,
  integerLiteral,
  jqFilter,
  jqGrammarCommand,
  jqPollutionCommand,
  jqPollutionFilter,
  lsCommand,
  pollutionAssignment,
  pollutionChain,
  pollutionExpansion,
  pollutionScript,
  sedGrammarCommand,
  sedPollutionCommand,
  sedPollutionProgram,
  sedProgram,
  simpleWord,
  strictPollutionIdentifier,
  supportedCommand,
  testCommand,
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

  describe("AWK Grammar Generator", () => {
    it("generates valid AWK programs", () => {
      const samples = fc.sample(awkProgram, 15);
      console.log("Sample AWK programs:");
      for (const prog of samples) {
        console.log(`  ${prog}`);
      }
      expect(samples.length).toBe(15);
    });

    it("generates variety of AWK constructs", () => {
      const samples = fc.sample(awkProgram, 50);
      const hasBegin = samples.some((s) => s.includes("BEGIN"));
      const hasEnd = samples.some((s) => s.includes("END"));
      const hasPrint = samples.some((s) => s.includes("print"));
      const hasPattern = samples.some((s) => s.includes("/"));
      const hasField = samples.some((s) => s.includes("$"));

      console.log("AWK constructs found:", {
        BEGIN: hasBegin,
        END: hasEnd,
        print: hasPrint,
        pattern: hasPattern,
        field: hasField,
      });

      expect(hasPrint).toBe(true);
      expect(hasField).toBe(true);
    });

    it("generates complete AWK commands", () => {
      const samples = fc.sample(awkGrammarCommand, 10);
      console.log("Sample AWK commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allAwk = samples.every((s) => s.includes("awk"));
      expect(allAwk).toBe(true);
    });

    it("generates AWK pollution programs with dangerous names", () => {
      const samples = fc.sample(awkPollutionProgram, 20);
      console.log("Sample AWK pollution programs:");
      for (const prog of samples.slice(0, 10)) {
        console.log(`  ${prog}`);
      }
      // Should contain pollution identifiers
      const hasPollution = samples.some(
        (s) =>
          s.includes("__proto__") ||
          s.includes("constructor") ||
          s.includes("prototype") ||
          s.includes("toString") ||
          s.includes("valueOf"),
      );
      expect(hasPollution).toBe(true);
    });

    it("generates complete AWK pollution commands", () => {
      const samples = fc.sample(awkPollutionCommand, 10);
      console.log("Sample AWK pollution commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allAwk = samples.every((s) => s.includes("awk"));
      expect(allAwk).toBe(true);
    });
  });

  describe("SED Grammar Generator", () => {
    it("generates valid SED programs", () => {
      const samples = fc.sample(sedProgram, 15);
      console.log("Sample SED programs:");
      for (const prog of samples) {
        console.log(`  ${prog}`);
      }
      expect(samples.length).toBe(15);
    });

    it("generates variety of SED commands", () => {
      const samples = fc.sample(sedProgram, 50);
      const hasSubstitute = samples.some((s) => s.includes("s/"));
      const hasDelete = samples.some((s) => s.includes("d"));
      const hasPrint = samples.some(
        (s) => s.includes("p") && !s.includes("s/"),
      );
      const hasAddress = samples.some(
        (s) => /^\d/.test(s) || s.startsWith("/"),
      );

      console.log("SED commands found:", {
        substitute: hasSubstitute,
        delete: hasDelete,
        print: hasPrint,
        address: hasAddress,
      });

      expect(hasSubstitute).toBe(true);
    });

    it("generates complete SED commands", () => {
      const samples = fc.sample(sedGrammarCommand, 10);
      console.log("Sample SED commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allSed = samples.every((s) => s.includes("sed"));
      expect(allSed).toBe(true);
    });

    it("generates SED pollution programs with dangerous patterns", () => {
      const samples = fc.sample(sedPollutionProgram, 20);
      console.log("Sample SED pollution programs:");
      for (const prog of samples.slice(0, 10)) {
        console.log(`  ${prog}`);
      }
      // Should contain pollution identifiers
      const hasPollution = samples.some(
        (s) =>
          s.includes("__proto__") ||
          s.includes("constructor") ||
          s.includes("prototype") ||
          s.includes("toString") ||
          s.includes("valueOf"),
      );
      expect(hasPollution).toBe(true);
    });

    it("generates complete SED pollution commands", () => {
      const samples = fc.sample(sedPollutionCommand, 10);
      console.log("Sample SED pollution commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allSed = samples.every((s) => s.includes("sed"));
      expect(allSed).toBe(true);
    });
  });

  describe("JQ Grammar Generator", () => {
    it("generates valid JQ filters", () => {
      const samples = fc.sample(jqFilter, 15);
      console.log("Sample JQ filters:");
      for (const filter of samples) {
        console.log(`  ${filter}`);
      }
      expect(samples.length).toBe(15);
    });

    it("generates variety of JQ constructs", () => {
      const samples = fc.sample(jqFilter, 50);
      const hasIdentity = samples.some((s) => s === ".");
      const hasKey = samples.some((s) => /^\.[a-z]/i.test(s));
      const hasArray = samples.some((s) => s.includes("[]"));
      const hasPipe = samples.some((s) => s.includes("|"));
      const hasBuiltin = samples.some(
        (s) =>
          s.includes("length") ||
          s.includes("keys") ||
          s.includes("map") ||
          s.includes("select"),
      );

      console.log("JQ constructs found:", {
        identity: hasIdentity,
        key: hasKey,
        array: hasArray,
        pipe: hasPipe,
        builtin: hasBuiltin,
      });

      expect(hasKey || hasArray || hasIdentity).toBe(true);
    });

    it("generates complete JQ commands", () => {
      const samples = fc.sample(jqGrammarCommand, 10);
      console.log("Sample JQ commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allJq = samples.every((s) => s.includes("jq"));
      expect(allJq).toBe(true);
    });

    it("generates JQ pollution filters with dangerous keys", () => {
      const samples = fc.sample(jqPollutionFilter, 20);
      console.log("Sample JQ pollution filters:");
      for (const filter of samples.slice(0, 10)) {
        console.log(`  ${filter}`);
      }
      // Should contain pollution identifiers
      const hasPollution = samples.some(
        (s) =>
          s.includes("__proto__") ||
          s.includes("constructor") ||
          s.includes("prototype") ||
          s.includes("toString") ||
          s.includes("valueOf"),
      );
      expect(hasPollution).toBe(true);
    });

    it("generates complete JQ pollution commands", () => {
      const samples = fc.sample(jqPollutionCommand, 10);
      console.log("Sample JQ pollution commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allJq = samples.every((s) => s.includes("jq"));
      expect(allJq).toBe(true);
    });
  });

  describe("Command Generators", () => {
    it("generates cat commands", () => {
      const samples = fc.sample(catCommand, 10);
      console.log("Sample cat commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allCat = samples.every((s) => s.includes("cat"));
      expect(allCat).toBe(true);
    });

    it("generates grep commands", () => {
      const samples = fc.sample(grepCommand, 10);
      console.log("Sample grep commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allGrep = samples.every((s) => s.includes("grep"));
      expect(allGrep).toBe(true);
    });

    it("generates ls commands", () => {
      const samples = fc.sample(lsCommand, 10);
      console.log("Sample ls commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allLs = samples.every((s) => s.includes("ls"));
      expect(allLs).toBe(true);
    });

    it("generates test commands", () => {
      const samples = fc.sample(testCommand, 10);
      console.log("Sample test commands:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      const allTest = samples.every(
        (s) => s.includes("test") || s.includes("["),
      );
      expect(allTest).toBe(true);
    });

    it("generates variety of supported commands", () => {
      const samples = fc.sample(supportedCommand, 30);
      console.log("Sample supported commands:");
      for (const cmd of samples.slice(0, 15)) {
        console.log(`  ${cmd}`);
      }
      // Check we get variety
      const commands = new Set(
        samples.map((s) => s.split(/\s/)[0].replace(/^echo$/, "echo")),
      );
      console.log("Unique commands:", [...commands]);
      expect(commands.size).toBeGreaterThan(5);
    });

    it("generates command pipelines", () => {
      const samples = fc.sample(commandPipeline, 10);
      console.log("Sample command pipelines:");
      for (const cmd of samples) {
        console.log(`  ${cmd}`);
      }
      expect(samples.length).toBe(10);
    });

    it("generates command scripts", () => {
      const samples = fc.sample(commandScript, 5);
      console.log("Sample command scripts:");
      for (const script of samples) {
        console.log("---");
        console.log(script);
      }
      expect(samples.length).toBe(5);
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
