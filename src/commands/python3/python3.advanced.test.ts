import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("python3 advanced features", () => {
  describe("generators", () => {
    it("should create simple generators", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_generator.py << 'EOF'
def countdown(n):
    while n > 0:
        yield n
        n -= 1

print(list(countdown(3)))
EOF`);
      const result = await env.exec(`python3 /tmp/test_generator.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[3, 2, 1]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support generator expressions", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "print(sum(x**2 for x in range(5)))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("30\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support infinite generators with itertools", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_infinite_gen.py << 'EOF'
from itertools import islice, count
result = list(islice(count(10), 5))
print(result)
EOF`);
      const result = await env.exec(`python3 /tmp/test_infinite_gen.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[10, 11, 12, 13, 14]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("decorators", () => {
    it("should support simple decorators", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_decorator.py << 'EOF'
def uppercase(func):
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        return result.upper()
    return wrapper

@uppercase
def greet(name):
    return f"hello {name}"

print(greet("world"))
EOF`);
      const result = await env.exec(`python3 /tmp/test_decorator.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("HELLO WORLD\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support decorators with arguments", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_decorator_args.py << 'EOF'
def repeat(times):
    def decorator(func):
        def wrapper(*args, **kwargs):
            result = []
            for _ in range(times):
                result.append(func(*args, **kwargs))
            return result
        return wrapper
    return decorator

@repeat(3)
def say_hi():
    return "hi"

print(say_hi())
EOF`);
      const result = await env.exec(`python3 /tmp/test_decorator_args.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("['hi', 'hi', 'hi']\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support stacked decorators", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_stacked_decorators.py << 'EOF'
def add_prefix(func):
    def wrapper():
        return "PREFIX:" + func()
    return wrapper

def add_suffix(func):
    def wrapper():
        return func() + ":SUFFIX"
    return wrapper

@add_prefix
@add_suffix
def message():
    return "hello"

print(message())
EOF`);
      const result = await env.exec(`python3 /tmp/test_stacked_decorators.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("PREFIX:hello:SUFFIX\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("context managers", () => {
    it("should support custom context managers with class", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_context_class.py << 'EOF'
class Timer:
    def __enter__(self):
        print("entering")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        print("exiting")
        return False

with Timer():
    print("inside")
EOF`);
      const result = await env.exec(`python3 /tmp/test_context_class.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("entering\ninside\nexiting\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support contextlib.contextmanager", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_contextlib.py << 'EOF'
from contextlib import contextmanager

@contextmanager
def tag(name):
    print(f"<{name}>")
    yield
    print(f"</{name}>")

with tag("div"):
    print("content")
EOF`);
      const result = await env.exec(`python3 /tmp/test_contextlib.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("<div>\ncontent\n</div>\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("lambda functions", () => {
    it("should create and use lambdas", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "f = lambda x, y: x + y; print(f(3, 4))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("7\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use lambdas with map/filter", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_lambda.py << 'EOF'
numbers = [1, 2, 3, 4, 5]
squared = list(map(lambda x: x**2, numbers))
evens = list(filter(lambda x: x % 2 == 0, numbers))
print(squared)
print(evens)
EOF`);
      const result = await env.exec(`python3 /tmp/test_lambda.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[1, 4, 9, 16, 25]\n[2, 4]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use lambdas with sorted", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_lambda_sort.py << 'EOF'
pairs = [(1, 'one'), (2, 'two'), (3, 'three')]
sorted_by_name = sorted(pairs, key=lambda x: x[1])
print([p[1] for p in sorted_by_name])
EOF`);
      const result = await env.exec(`python3 /tmp/test_lambda_sort.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("['one', 'three', 'two']\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("closures", () => {
    it("should create closures", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_closure.py << 'EOF'
def make_multiplier(n):
    def multiply(x):
        return x * n
    return multiply

double = make_multiplier(2)
triple = make_multiplier(3)
print(double(5))
print(triple(5))
EOF`);
      const result = await env.exec(`python3 /tmp/test_closure.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("10\n15\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support nonlocal", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_nonlocal.py << 'EOF'
def make_counter():
    count = 0
    def counter():
        nonlocal count
        count += 1
        return count
    return counter

c = make_counter()
print(c())
print(c())
print(c())
EOF`);
      const result = await env.exec(`python3 /tmp/test_nonlocal.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("1\n2\n3\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("type hints", () => {
    it("should support basic type hints", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_types.py << 'EOF'
def greet(name: str) -> str:
    return f"Hello, {name}"

def add(a: int, b: int) -> int:
    return a + b

print(greet("World"))
print(add(3, 4))
EOF`);
      const result = await env.exec(`python3 /tmp/test_types.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Hello, World\n7\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support typing module", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_typing.py << 'EOF'
from typing import List, Dict, Optional

def process(items: List[int]) -> Dict[str, int]:
    return {"sum": sum(items), "count": len(items)}

def maybe_double(x: Optional[int]) -> int:
    if x is None:
        return 0
    return x * 2

print(process([1, 2, 3]))
print(maybe_double(5))
print(maybe_double(None))
EOF`);
      const result = await env.exec(`python3 /tmp/test_typing.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("{'sum': 6, 'count': 3}\n10\n0\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("walrus operator", () => {
    it("should support assignment expressions", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_walrus.py << 'EOF'
numbers = [1, 2, 3, 4, 5]
if (n := len(numbers)) > 3:
    print(f"list has {n} elements")
EOF`);
      const result = await env.exec(`python3 /tmp/test_walrus.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("list has 5 elements\n");
      expect(result.exitCode).toBe(0);
    });

    it("should work in list comprehensions", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_walrus_comp.py << 'EOF'
data = [1, 2, 3, 4, 5]
results = [y for x in data if (y := x * 2) > 4]
print(results)
EOF`);
      const result = await env.exec(`python3 /tmp/test_walrus_comp.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[6, 8, 10]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("f-strings", () => {
    it("should support basic f-strings", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "name='World'; print(f'Hello, {name}!')"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Hello, World!\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support f-string expressions", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "print(f'{2 + 2 = }')"`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("2 + 2 = 4\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support f-string formatting", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_fstring.py << 'EOF'
pi = 3.14159
print(f"{pi:.2f}")
n = 42
print(f"{n:05d}")
EOF`);
      const result = await env.exec(`python3 /tmp/test_fstring.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("3.14\n00042\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("unpacking", () => {
    it("should support extended unpacking", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_unpack.py << 'EOF'
first, *middle, last = [1, 2, 3, 4, 5]
print(first)
print(middle)
print(last)
EOF`);
      const result = await env.exec(`python3 /tmp/test_unpack.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("1\n[2, 3, 4]\n5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support dictionary unpacking", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_dict_unpack.py << 'EOF'
d1 = {'a': 1, 'b': 2}
d2 = {'c': 3, 'd': 4}
merged = {**d1, **d2}
print(sorted(merged.items()))
EOF`);
      const result = await env.exec(`python3 /tmp/test_dict_unpack.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[('a', 1), ('b', 2), ('c', 3), ('d', 4)]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("match statement (Python 3.10+)", () => {
    it("should support basic match", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_match.py << 'EOF'
def describe(x):
    match x:
        case 0:
            return "zero"
        case 1:
            return "one"
        case _:
            return "other"

print(describe(0))
print(describe(1))
print(describe(42))
EOF`);
      const result = await env.exec(`python3 /tmp/test_match.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("zero\none\nother\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support match with patterns", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_match_pattern.py << 'EOF'
def process(data):
    match data:
        case [x, y]:
            return f"pair: {x}, {y}"
        case [x, y, z]:
            return f"triple: {x}, {y}, {z}"
        case _:
            return "unknown"

print(process([1, 2]))
print(process([1, 2, 3]))
EOF`);
      const result = await env.exec(`python3 /tmp/test_match_pattern.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("pair: 1, 2\ntriple: 1, 2, 3\n");
      expect(result.exitCode).toBe(0);
    });
  });

  // Note: asyncio.run() requires WebAssembly stack switching which isn't
  // supported in our JavaScript runtime. These tests are skipped.
  describe("async/await", () => {
    it.skip("should support async functions", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_async.py << 'EOF'
import asyncio

async def greet():
    return "hello"

async def main():
    result = await greet()
    print(result)

asyncio.run(main())
EOF`);
      const result = await env.exec(`python3 /tmp/test_async.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it.skip("should support async list operations", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_async_list.py << 'EOF'
import asyncio

async def double(x):
    return x * 2

async def main():
    tasks = [double(i) for i in range(3)]
    results = await asyncio.gather(*tasks)
    print(results)

asyncio.run(main())
EOF`);
      const result = await env.exec(`python3 /tmp/test_async_list.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[0, 2, 4]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("enum", () => {
    it("should support basic enums", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_enum.py << 'EOF'
from enum import Enum

class Color(Enum):
    RED = 1
    GREEN = 2
    BLUE = 3

print(Color.RED)
print(Color.RED.value)
print(Color.RED.name)
EOF`);
      const result = await env.exec(`python3 /tmp/test_enum.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Color.RED\n1\nRED\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
