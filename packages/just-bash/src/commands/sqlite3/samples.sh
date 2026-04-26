#!/bin/bash
# Sample sqlite3 commands for comparing output with just-bash implementation

echo "=== Basic Operations ==="

echo "--- Create table and query data ---"
sqlite3 :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2),(3); SELECT * FROM t"

echo "--- Multiple columns ---"
sqlite3 :memory: "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES(1,'x'),(2,'y'); SELECT * FROM t"

echo ""
echo "=== Output Modes ==="

echo "--- CSV mode (-csv) ---"
sqlite3 -csv :memory: "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,'hello'),(2,'world'); SELECT * FROM t"

echo "--- CSV escaping ---"
sqlite3 -csv :memory: "CREATE TABLE t(a); INSERT INTO t VALUES('hello,world'),('has
newline'); SELECT * FROM t"

echo "--- JSON mode (-json) ---"
sqlite3 -json :memory: "CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES(1,'alice'),(2,'bob'); SELECT * FROM t"

echo "--- Line mode (-line) ---"
sqlite3 -line :memory: "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES(1,'x'); SELECT * FROM t"

echo "--- Column mode (-column -header) ---"
sqlite3 -column -header :memory: "CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES(1,'alice'); SELECT * FROM t"

echo "--- Table mode (-table -header) ---"
sqlite3 -table -header :memory: "CREATE TABLE t(a INT); INSERT INTO t VALUES(1); SELECT * FROM t"

echo "--- Markdown mode (-markdown -header) ---"
sqlite3 -markdown -header :memory: "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES(1,'x'); SELECT * FROM t"

echo ""
echo "=== Header Options ==="

echo "--- With headers (-header) ---"
sqlite3 -header :memory: "CREATE TABLE t(col1 INT, col2 TEXT); INSERT INTO t VALUES(1,'a'); SELECT * FROM t"

echo "--- Without headers (-noheader) ---"
sqlite3 -noheader :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1); SELECT * FROM t"

echo ""
echo "=== Separator Options ==="

echo "--- Custom separator (comma) ---"
sqlite3 -separator "," :memory: "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2); SELECT * FROM t"

echo "--- Tab separator ---"
sqlite3 -separator "	" :memory: "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2); SELECT * FROM t"

echo ""
echo "=== Null Value Option ==="

echo "--- Custom null value ---"
sqlite3 -nullvalue "NULL" :memory: "CREATE TABLE t(x); INSERT INTO t VALUES(1),(NULL); SELECT * FROM t"

echo ""
echo "=== Stdin Input ==="

echo "--- SQL from stdin ---"
echo "CREATE TABLE t(x); INSERT INTO t VALUES(42); SELECT * FROM t" | sqlite3 :memory:

echo ""
echo "=== Multiple Statements ==="

echo "--- Multiple tables and queries ---"
sqlite3 :memory: "CREATE TABLE a(x); CREATE TABLE b(y); INSERT INTO a VALUES(1); INSERT INTO b VALUES(2); SELECT * FROM a; SELECT * FROM b"

echo ""
echo "=== Data Types ==="

echo "--- NULL values (JSON) ---"
sqlite3 -json :memory: "CREATE TABLE t(x); INSERT INTO t VALUES(NULL); SELECT * FROM t"

echo "--- Integers and floats (JSON) ---"
sqlite3 -json :memory: "CREATE TABLE t(i INT, f REAL); INSERT INTO t VALUES(42, 3.14); SELECT * FROM t"

echo ""
echo "=== Error Handling ==="

echo "--- SQL syntax error ---"
sqlite3 :memory: "SELEC * FROM t"

echo "--- Missing table ---"
sqlite3 :memory: "SELECT * FROM nonexistent"

echo "--- Bail on error (-bail) ---"
sqlite3 -bail :memory: "SELECT * FROM bad; SELECT 1"

echo ""
echo "=== Priority 1: Quick Wins ==="

echo "--- Version (-version) ---"
sqlite3 -version

echo "--- End of options (--) ---"
sqlite3 :memory: -- "SELECT 1 as value"

echo "--- Tabs mode (-tabs) ---"
sqlite3 -tabs :memory: "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2),(3,4); SELECT * FROM t"

echo ""
echo "=== Priority 2: Output Modes ==="

echo "--- Box mode (-box) ---"
sqlite3 -box :memory: "CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES(1,'alice'),(2,'bob'); SELECT * FROM t"

echo "--- Quote mode (-quote) ---"
sqlite3 -quote :memory: "CREATE TABLE t(a INT, b TEXT); INSERT INTO t VALUES(1,'hello'),(NULL,'world'); SELECT * FROM t"

echo "--- HTML mode (-html) ---"
sqlite3 -html :memory: "CREATE TABLE t(id INT, name TEXT); INSERT INTO t VALUES(1,'alice'); SELECT * FROM t"

echo ""
echo "=== Priority 3: Nice to Have ==="

echo "--- ASCII mode (-ascii) ---"
sqlite3 -ascii :memory: "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2),(3,4); SELECT * FROM t"

echo "--- Newline separator (-newline) ---"
sqlite3 -newline '|' :memory: "CREATE TABLE t(x); INSERT INTO t VALUES(1),(2),(3); SELECT * FROM t"

echo "--- Echo mode (-echo) ---"
sqlite3 -echo :memory: "SELECT 1; SELECT 2"

echo "--- Cmd option (-cmd) ---"
sqlite3 -cmd "CREATE TABLE t(x); INSERT INTO t VALUES(42)" :memory: "SELECT * FROM t"

echo ""
echo "=== Error Handling Edge Cases ==="

echo "--- Missing option argument (-separator as last arg) ---"
sqlite3 :memory: -separator 2>&1 || true

echo "--- Unknown option ---"
sqlite3 -xyz :memory: "SELECT 1" 2>&1 || true

echo "--- Unknown long option ---"
sqlite3 --xyz :memory: "SELECT 1" 2>&1 || true

echo ""
echo "=== SQL Parsing Edge Cases ==="

echo "--- Semicolon inside string ---"
sqlite3 :memory: "CREATE TABLE t(x); INSERT INTO t VALUES('a;b'); SELECT * FROM t"

echo "--- Semicolon inside double-quoted identifier ---"
sqlite3 :memory: "CREATE TABLE t(\"col;name\" TEXT); INSERT INTO t VALUES('test'); SELECT * FROM t"

echo "--- Multiple semicolons in string ---"
sqlite3 :memory: "CREATE TABLE t(x); INSERT INTO t VALUES('a;b;c;d'); SELECT * FROM t"

echo "--- Escaped single quotes (SQLite style) ---"
sqlite3 :memory: "CREATE TABLE t(x); INSERT INTO t VALUES('it''s'); SELECT * FROM t"

echo "--- Empty statement (multiple semicolons) ---"
sqlite3 :memory: "SELECT 1;;; SELECT 2"

echo "--- Statement without trailing semicolon ---"
sqlite3 :memory: "SELECT 42"

echo ""
echo "=== Formatter Edge Cases ==="

echo "--- Line mode alignment ---"
sqlite3 -line :memory: "SELECT 1 as aa, 2 as bbbb"

echo "--- JSON empty result ---"
sqlite3 -json :memory: "CREATE TABLE t(x INT); SELECT * FROM t"

echo "--- HTML entity escaping ---"
sqlite3 -html :memory: "SELECT '<div>&</div>'"

echo "--- BLOB handling (hex output) ---"
sqlite3 :memory: "SELECT X'48454C4C4F'"

echo "--- Quote mode with NULL ---"
sqlite3 -quote :memory: "SELECT NULL"

echo "--- Quote mode with integer ---"
sqlite3 -quote :memory: "SELECT 42"

echo "--- Quote mode with float ---"
sqlite3 -quote :memory: "SELECT 3.14"

echo "--- Quote mode with string ---"
sqlite3 -quote :memory: "SELECT 'hello'"

echo "--- CSV embedded quotes ---"
sqlite3 -csv :memory: "SELECT 'he said ''hello'''"

echo "--- Box mode single column ---"
sqlite3 -box :memory: "SELECT 42 as value"

echo "--- Table mode empty result with header ---"
sqlite3 -table -header :memory: "CREATE TABLE t(x); SELECT * FROM t"

echo ""
echo "=== Write Operations ==="

echo "--- UPDATE rows ---"
sqlite3 :memory: "CREATE TABLE t(id INT, val TEXT); INSERT INTO t VALUES(1,'a'),(2,'b'); UPDATE t SET val='x' WHERE id=1; SELECT * FROM t ORDER BY id"

echo "--- DELETE rows ---"
sqlite3 :memory: "CREATE TABLE t(x INT); INSERT INTO t VALUES(1),(2),(3); DELETE FROM t WHERE x=2; SELECT * FROM t ORDER BY x"

echo "--- DROP TABLE ---"
sqlite3 :memory: "CREATE TABLE t(x); DROP TABLE t; SELECT name FROM sqlite_master WHERE type='table'"

echo "--- ALTER TABLE RENAME ---"
sqlite3 :memory: "CREATE TABLE old(x); ALTER TABLE old RENAME TO new; SELECT name FROM sqlite_master WHERE type='table'"

echo "--- ALTER TABLE ADD COLUMN ---"
sqlite3 :memory: "CREATE TABLE t(a INT); INSERT INTO t VALUES(1); ALTER TABLE t ADD COLUMN b TEXT DEFAULT 'x'; SELECT * FROM t"

echo "--- REPLACE INTO ---"
sqlite3 :memory: "CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT); INSERT INTO t VALUES(1,'a'); REPLACE INTO t VALUES(1,'b'); SELECT * FROM t"

echo ""
echo "=== Combined Options ==="

echo "--- CSV + header + nullvalue ---"
sqlite3 -csv -header -nullvalue "N/A" :memory: "SELECT 1 as a, NULL as b"

echo "--- JSON + cmd ---"
sqlite3 -json -cmd "CREATE TABLE t(x); INSERT INTO t VALUES(42)" :memory: "SELECT * FROM t"

echo "--- Echo + header ---"
sqlite3 -echo -header :memory: "SELECT 1 as x"

echo ""
echo "=== Nullvalue with Different Modes ==="

echo "--- Nullvalue in list mode ---"
sqlite3 -nullvalue "N/A" :memory: "SELECT NULL, 1"

echo "--- Nullvalue in CSV mode ---"
sqlite3 -csv -nullvalue "N/A" :memory: "SELECT NULL, 1"

echo "--- Nullvalue in column mode ---"
sqlite3 -column -nullvalue "NULL" :memory: "SELECT NULL as x"
