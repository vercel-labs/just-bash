import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("python3 data structures", () => {
  describe("lists", () => {
    it("should create and manipulate lists", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_list.py << 'EOF'
lst = [1, 2, 3]
lst.append(4)
lst.extend([5, 6])
print(lst)
print(len(lst))
EOF`);
      const result = await env.exec(`python3 /tmp/test_list.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[1, 2, 3, 4, 5, 6]\n6\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support list slicing", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_slice.py << 'EOF'
lst = [0, 1, 2, 3, 4, 5]
print(lst[2:4])
print(lst[::2])
print(lst[::-1])
EOF`);
      const result = await env.exec(`python3 /tmp/test_slice.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[2, 3]\n[0, 2, 4]\n[5, 4, 3, 2, 1, 0]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support list comprehensions", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "print([x**2 for x in range(5)])"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[0, 1, 4, 9, 16]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support nested list comprehensions", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_nested_comp.py << 'EOF'
matrix = [[i*j for j in range(3)] for i in range(3)]
print(matrix)
EOF`);
      const result = await env.exec(`python3 /tmp/test_nested_comp.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[[0, 0, 0], [0, 1, 2], [0, 2, 4]]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("dictionaries", () => {
    it("should create and access dicts", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_dict.py << 'EOF'
d = {'a': 1, 'b': 2}
d['c'] = 3
print(d['a'])
print(sorted(d.keys()))
EOF`);
      const result = await env.exec(`python3 /tmp/test_dict.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("1\n['a', 'b', 'c']\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support dict comprehensions", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_dict_comp.py << 'EOF'
d = {x: x**2 for x in range(4)}
print(sorted(d.items()))
EOF`);
      const result = await env.exec(`python3 /tmp/test_dict_comp.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[(0, 0), (1, 1), (2, 4), (3, 9)]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support dict methods", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_dict_methods.py << 'EOF'
d = {'a': 1, 'b': 2}
print(d.get('c', 'default'))
d.update({'c': 3})
print(sorted(d.keys()))
EOF`);
      const result = await env.exec(`python3 /tmp/test_dict_methods.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("default\n['a', 'b', 'c']\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("sets", () => {
    it("should create and manipulate sets", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_set.py << 'EOF'
s = {1, 2, 3}
s.add(4)
s.add(2)  # duplicate
print(sorted(s))
EOF`);
      const result = await env.exec(`python3 /tmp/test_set.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[1, 2, 3, 4]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support set operations", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_set_ops.py << 'EOF'
a = {1, 2, 3}
b = {2, 3, 4}
print(sorted(a & b))
print(sorted(a | b))
print(sorted(a - b))
EOF`);
      const result = await env.exec(`python3 /tmp/test_set_ops.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[2, 3]\n[1, 2, 3, 4]\n[1]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support set comprehensions", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "print(sorted({x%3 for x in range(10)}))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[0, 1, 2]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("tuples", () => {
    it("should create and unpack tuples", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_tuple.py << 'EOF'
t = (1, 2, 3)
a, b, c = t
print(a, b, c)
print(len(t))
EOF`);
      const result = await env.exec(`python3 /tmp/test_tuple.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("1 2 3\n3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support named tuples", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_namedtuple.py << 'EOF'
from collections import namedtuple
Point = namedtuple('Point', ['x', 'y'])
p = Point(3, 4)
print(p.x, p.y)
EOF`);
      const result = await env.exec(`python3 /tmp/test_namedtuple.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("3 4\n");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("python3 OOP", () => {
  describe("classes", () => {
    it("should define and instantiate classes", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_class.py << 'EOF'
class Dog:
    def __init__(self, name):
        self.name = name

    def bark(self):
        return f"{self.name} says woof!"

dog = Dog("Buddy")
print(dog.bark())
EOF`);
      const result = await env.exec(`python3 /tmp/test_class.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Buddy says woof!\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support inheritance", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_inheritance.py << 'EOF'
class Animal:
    def speak(self):
        return "..."

class Cat(Animal):
    def speak(self):
        return "meow"

class Dog(Animal):
    def speak(self):
        return "woof"

animals = [Cat(), Dog()]
for a in animals:
    print(a.speak())
EOF`);
      const result = await env.exec(`python3 /tmp/test_inheritance.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("meow\nwoof\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support class methods and static methods", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_classmethods.py << 'EOF'
class Counter:
    count = 0

    def __init__(self):
        Counter.count += 1

    @classmethod
    def get_count(cls):
        return cls.count

    @staticmethod
    def description():
        return "A counter class"

c1 = Counter()
c2 = Counter()
print(Counter.get_count())
print(Counter.description())
EOF`);
      const result = await env.exec(`python3 /tmp/test_classmethods.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("2\nA counter class\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support properties", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_property.py << 'EOF'
class Circle:
    def __init__(self, radius):
        self._radius = radius

    @property
    def radius(self):
        return self._radius

    @radius.setter
    def radius(self, value):
        if value < 0:
            raise ValueError("Radius cannot be negative")
        self._radius = value

c = Circle(5)
print(c.radius)
c.radius = 10
print(c.radius)
EOF`);
      const result = await env.exec(`python3 /tmp/test_property.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("5\n10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support dataclasses", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_dataclass.py << 'EOF'
from dataclasses import dataclass

@dataclass
class Point:
    x: int
    y: int

p = Point(3, 4)
print(p.x, p.y)
print(p)
EOF`);
      const result = await env.exec(`python3 /tmp/test_dataclass.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("3 4\nPoint(x=3, y=4)\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("magic methods", () => {
    it("should support __str__ and __repr__", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_magic.py << 'EOF'
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __str__(self):
        return f"Point({self.x}, {self.y})"

    def __repr__(self):
        return f"Point(x={self.x}, y={self.y})"

p = Point(3, 4)
print(str(p))
print(repr(p))
EOF`);
      const result = await env.exec(`python3 /tmp/test_magic.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Point(3, 4)\nPoint(x=3, y=4)\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support comparison methods", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_comparison.py << 'EOF'
class Number:
    def __init__(self, value):
        self.value = value

    def __eq__(self, other):
        return self.value == other.value

    def __lt__(self, other):
        return self.value < other.value

a = Number(5)
b = Number(10)
c = Number(5)
print(a == c)
print(a < b)
EOF`);
      const result = await env.exec(`python3 /tmp/test_comparison.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("True\nTrue\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support arithmetic methods", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_arithmetic.py << 'EOF'
class Vector:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __add__(self, other):
        return Vector(self.x + other.x, self.y + other.y)

    def __str__(self):
        return f"Vector({self.x}, {self.y})"

v1 = Vector(1, 2)
v2 = Vector(3, 4)
v3 = v1 + v2
print(v3)
EOF`);
      const result = await env.exec(`python3 /tmp/test_arithmetic.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Vector(4, 6)\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support __len__ and __getitem__", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_container.py << 'EOF'
class MyList:
    def __init__(self, items):
        self._items = items

    def __len__(self):
        return len(self._items)

    def __getitem__(self, index):
        return self._items[index]

ml = MyList([1, 2, 3, 4, 5])
print(len(ml))
print(ml[2])
EOF`);
      const result = await env.exec(`python3 /tmp/test_container.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("5\n3\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("exception handling", () => {
    it("should handle try/except", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_exception.py << 'EOF'
try:
    x = 1 / 0
except ZeroDivisionError:
    print("caught division by zero")
EOF`);
      const result = await env.exec(`python3 /tmp/test_exception.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("caught division by zero\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle multiple exceptions", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_multi_except.py << 'EOF'
def test(x):
    try:
        if x == 0:
            raise ValueError("zero")
        return 10 / x
    except ValueError as e:
        return f"value error: {e}"
    except ZeroDivisionError:
        return "division error"

print(test(0))
print(test(2))
EOF`);
      const result = await env.exec(`python3 /tmp/test_multi_except.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("value error: zero\n5.0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle finally", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_finally.py << 'EOF'
def test():
    try:
        return "try"
    finally:
        print("finally")

result = test()
print(result)
EOF`);
      const result = await env.exec(`python3 /tmp/test_finally.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("finally\ntry\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support custom exceptions", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_custom_exception.py << 'EOF'
class MyError(Exception):
    def __init__(self, message):
        self.message = message

try:
    raise MyError("custom error")
except MyError as e:
    print(f"caught: {e.message}")
EOF`);
      const result = await env.exec(`python3 /tmp/test_custom_exception.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("caught: custom error\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
