import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("python3 standard library", () => {
  describe("json module", () => {
    it("should serialize to JSON", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import json; print(json.dumps({'name': 'test', 'value': 42}))"`,
      );
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed).toEqual({ name: "test", value: 42 });
      expect(result.exitCode).toBe(0);
    });

    it("should parse JSON", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import json; data = json.loads('[1, 2, 3]'); print(sum(data))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("6\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle nested JSON", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_json.py << 'EOF'
import json
data = {"users": [{"name": "alice"}, {"name": "bob"}]}
print(json.dumps(data, sort_keys=True))
EOF`);
      const result = await env.exec(`python3 /tmp/test_json.py`);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.users[0].name).toBe("alice");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("math module", () => {
    it("should calculate sqrt", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import math; print(math.sqrt(16))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("4.0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should provide constants", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import math; print(round(math.pi, 5))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("3.14159\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle trigonometry", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import math; print(int(math.sin(math.pi/2)))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("re module", () => {
    it("should match patterns", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import re; print(bool(re.match(r'hello', 'hello world')))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("True\n");
      expect(result.exitCode).toBe(0);
    });

    it("should find all matches", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_regex.py << 'EOF'
import re
text = "cat bat rat"
matches = re.findall(r'[cbr]at', text)
print(matches)
EOF`);
      const result = await env.exec(`python3 /tmp/test_regex.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("['cat', 'bat', 'rat']\n");
      expect(result.exitCode).toBe(0);
    });

    it("should substitute patterns", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import re; print(re.sub(r'\\\\d+', 'X', 'a1b2c3'))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("aXbXcX\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("datetime module", () => {
    it("should create dates", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_date.py << 'EOF'
from datetime import date
d = date(2024, 1, 15)
print(d.year, d.month, d.day)
EOF`);
      const result = await env.exec(`python3 /tmp/test_date.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("2024 1 15\n");
      expect(result.exitCode).toBe(0);
    });

    it("should format dates", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_dateformat.py << 'EOF'
from datetime import datetime
dt = datetime(2024, 6, 15, 10, 30)
print(dt.strftime("%Y-%m-%d"))
EOF`);
      const result = await env.exec(`python3 /tmp/test_dateformat.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("2024-06-15\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("collections module", () => {
    it("should use Counter", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_counter.py << 'EOF'
from collections import Counter
c = Counter('abracadabra')
print(c['a'])
EOF`);
      const result = await env.exec(`python3 /tmp/test_counter.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use defaultdict", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_defaultdict.py << 'EOF'
from collections import defaultdict
d = defaultdict(list)
d['key'].append(1)
d['key'].append(2)
print(d['key'])
EOF`);
      const result = await env.exec(`python3 /tmp/test_defaultdict.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[1, 2]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use OrderedDict", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_ordereddict.py << 'EOF'
from collections import OrderedDict
d = OrderedDict()
d['a'] = 1
d['b'] = 2
d['c'] = 3
print(list(d.keys()))
EOF`);
      const result = await env.exec(`python3 /tmp/test_ordereddict.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("['a', 'b', 'c']\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("itertools module", () => {
    it("should use chain", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_chain.py << 'EOF'
from itertools import chain
result = list(chain([1, 2], [3, 4]))
print(result)
EOF`);
      const result = await env.exec(`python3 /tmp/test_chain.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[1, 2, 3, 4]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use combinations", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_combinations.py << 'EOF'
from itertools import combinations
result = list(combinations('ABC', 2))
print(result)
EOF`);
      const result = await env.exec(`python3 /tmp/test_combinations.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[('A', 'B'), ('A', 'C'), ('B', 'C')]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("functools module", () => {
    it("should use reduce", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_reduce.py << 'EOF'
from functools import reduce
result = reduce(lambda x, y: x + y, [1, 2, 3, 4])
print(result)
EOF`);
      const result = await env.exec(`python3 /tmp/test_reduce.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use lru_cache", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_lru_cache.py << 'EOF'
from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    if n < 2:
        return n
    return fib(n-1) + fib(n-2)

print(fib(10))
EOF`);
      const result = await env.exec(`python3 /tmp/test_lru_cache.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("55\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("hashlib module", () => {
    it("should calculate md5", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_md5.py << 'EOF'
import hashlib
h = hashlib.md5(b'hello').hexdigest()
print(h)
EOF`);
      const result = await env.exec(`python3 /tmp/test_md5.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("5d41402abc4b2a76b9719d911017c592\n");
      expect(result.exitCode).toBe(0);
    });

    it("should calculate sha256", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_sha256.py << 'EOF'
import hashlib
h = hashlib.sha256(b'hello').hexdigest()
print(h[:16])
EOF`);
      const result = await env.exec(`python3 /tmp/test_sha256.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("2cf24dba5fb0a30e\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("base64 module", () => {
    it("should encode base64", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_b64encode.py << 'EOF'
import base64
encoded = base64.b64encode(b'hello world').decode()
print(encoded)
EOF`);
      const result = await env.exec(`python3 /tmp/test_b64encode.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("aGVsbG8gd29ybGQ=\n");
      expect(result.exitCode).toBe(0);
    });

    it("should decode base64", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_b64decode.py << 'EOF'
import base64
decoded = base64.b64decode('aGVsbG8gd29ybGQ=').decode()
print(decoded)
EOF`);
      const result = await env.exec(`python3 /tmp/test_b64decode.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("hello world\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("pathlib module", () => {
    it("should handle path operations", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_pathlib.py << 'EOF'
from pathlib import PurePosixPath
p = PurePosixPath('/home/user/file.txt')
print(p.name)
print(p.suffix)
print(p.parent)
EOF`);
      const result = await env.exec(`python3 /tmp/test_pathlib.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("file.txt\n.txt\n/home/user\n");
      expect(result.exitCode).toBe(0);
    });

    it("should join paths", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_pathjoin.py << 'EOF'
from pathlib import PurePosixPath
p = PurePosixPath('/home') / 'user' / 'file.txt'
print(p)
EOF`);
      const result = await env.exec(`python3 /tmp/test_pathjoin.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("/home/user/file.txt\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("random module", () => {
    it("should generate random choice", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_random.py << 'EOF'
import random
random.seed(42)
print(random.choice([1, 2, 3, 4, 5]))
EOF`);
      const result = await env.exec(`python3 /tmp/test_random.py`);
      expect(result.stderr).toBe("");
      // With seed 42, the choice should be deterministic
      expect(["1\n", "2\n", "3\n", "4\n", "5\n"]).toContain(result.stdout);
      expect(result.exitCode).toBe(0);
    });

    it("should shuffle list", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_shuffle.py << 'EOF'
import random
random.seed(42)
items = [1, 2, 3]
random.shuffle(items)
print(len(items))
EOF`);
      const result = await env.exec(`python3 /tmp/test_shuffle.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("textwrap module", () => {
    it("should wrap text", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_textwrap.py << 'EOF'
import textwrap
text = "Hello World"
wrapped = textwrap.fill(text, width=5)
print(wrapped)
EOF`);
      const result = await env.exec(`python3 /tmp/test_textwrap.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Hello\nWorld\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
