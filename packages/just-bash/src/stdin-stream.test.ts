import { describe, expect, it } from "vitest";
import { latin1FromBytes } from "./encoding.js";
import { StdinStream } from "./stdin-stream.js";

describe("StdinStream", () => {
  it("peek returns full content initially without consuming", () => {
    const s = new StdinStream("hello\nworld\n");
    expect(latin1FromBytes(s.peek())).toBe("hello\nworld\n");
    expect(latin1FromBytes(s.peek())).toBe("hello\nworld\n");
    expect(s.exhausted).toBe(false);
  });

  it("defaults to empty content", () => {
    const s = new StdinStream();
    expect(latin1FromBytes(s.peek())).toBe("");
    expect(s.exhausted).toBe(true);
  });

  it("exhausted is true on empty content", () => {
    expect(new StdinStream("").exhausted).toBe(true);
  });

  it("advance moves position forward", () => {
    const s = new StdinStream("hello\nworld\n");
    s.advance(6);
    expect(latin1FromBytes(s.peek())).toBe("world\n");
  });

  it("advance clamps to content length", () => {
    const s = new StdinStream("abc");
    s.advance(1000);
    expect(latin1FromBytes(s.peek())).toBe("");
    expect(s.exhausted).toBe(true);
  });

  it("advance by zero or negative does nothing", () => {
    const s = new StdinStream("abc");
    s.advance(0);
    s.advance(-5);
    expect(latin1FromBytes(s.peek())).toBe("abc");
    expect(s.exhausted).toBe(false);
  });

  it("readAll returns remaining and exhausts the stream", () => {
    const s = new StdinStream("hello\nworld\n");
    s.advance(6);
    expect(latin1FromBytes(s.readAll())).toBe("world\n");
    expect(s.exhausted).toBe(true);
    expect(latin1FromBytes(s.peek())).toBe("");
  });

  it("readAll on empty content returns empty string", () => {
    const s = new StdinStream("");
    expect(latin1FromBytes(s.readAll())).toBe("");
    expect(s.exhausted).toBe(true);
  });

  it("readAll after exhaustion returns empty string", () => {
    const s = new StdinStream("abc");
    s.readAll();
    expect(latin1FromBytes(s.readAll())).toBe("");
  });

  it("multiple advances accumulate correctly", () => {
    const s = new StdinStream("abcdef");
    s.advance(2);
    s.advance(2);
    expect(latin1FromBytes(s.peek())).toBe("ef");
    expect(s.exhausted).toBe(false);
  });

  it("exhausted becomes true after advance to exact end", () => {
    const s = new StdinStream("abc");
    s.advance(3);
    expect(s.exhausted).toBe(true);
    expect(latin1FromBytes(s.peek())).toBe("");
  });

  it("consumption is shared across holders of the same reference", () => {
    const s = new StdinStream("a\nb\nc\n");
    const alias = s;
    alias.advance(2);
    expect(latin1FromBytes(s.peek())).toBe("b\nc\n");
    s.readAll();
    expect(alias.exhausted).toBe(true);
  });
});
