// Portable CLI fixture. Build with:
// zig cc -target wasm32-wasi -O2 command.c -o command.wasm
// Also builds as an ordinary native executable for comparison tests.
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 2 || strcmp(argv[1], "--help") == 0) {
    puts("usage: wasi-fixture args|env|cat|write|append|binary|fs|open|loop|grow|exit");
    return 0;
  }
  if (strcmp(argv[1], "args") == 0) {
    for (int i = 2; i < argc; i++) printf("[%s]\n", argv[i]);
  } else if (strcmp(argv[1], "env") == 0) {
    const char *value = getenv(argv[2]);
    printf("%s\n", value ? value : "<unset>");
  } else if (strcmp(argv[1], "cat") == 0) {
    FILE *in = argc > 2 ? fopen(argv[2], "rb") : stdin;
    if (!in) { perror("open"); return 2; }
    unsigned char bytes[4096];
    size_t length;
    while ((length = fread(bytes, 1, sizeof(bytes), in)) > 0)
      if (fwrite(bytes, 1, length, stdout) != length) return 3;
    int failed = ferror(in);
    if (in != stdin) fclose(in);
    return failed ? 4 : 0;
  } else if (strcmp(argv[1], "write") == 0 || strcmp(argv[1], "append") == 0) {
    FILE *out = fopen(argv[2], argv[1][0] == 'w' ? "wb" : "ab");
    if (!out) return 2;
    fputs(argv[3], out);
    return fclose(out) ? 3 : 0;
  } else if (strcmp(argv[1], "binary") == 0) {
    unsigned char bytes[] = {0, 255, 128, 195, 169, 10};
    fwrite(bytes, 1, sizeof(bytes), stdout);
    fputs("diagnostic café\n", stderr);
  } else if (strcmp(argv[1], "fs") == 0) {
    if (mkdir("work", 0755) != 0) return 2;
    FILE *file = fopen("work/a", "w+b");
    if (!file) return 3;
    fputs("abc", file);
    fseek(file, 1, SEEK_SET);
    fputs("Z", file);
    fflush(file);
    fseek(file, 0, SEEK_SET);
    char bytes[4] = {0};
    fread(bytes, 1, 3, file);
    printf("%s\n", bytes);
    fclose(file);
    if (rename("work/a", "work/b") != 0) return 4;
    struct stat statbuf;
    if (stat("work/b", &statbuf) != 0) return 5;
    printf("size=%ld\n", (long)statbuf.st_size);
    DIR *directory = opendir("work");
    if (!directory) return 6;
    struct dirent *entry;
    while ((entry = readdir(directory)))
      if (entry->d_name[0] != '.') printf("file=%s\n", entry->d_name);
    closedir(directory);
    if (unlink("work/b") != 0 || rmdir("work") != 0) return 7;
  } else if (strcmp(argv[1], "open") == 0) {
    FILE *file = fopen(argv[2], "rb");
    if (file) { fclose(file); puts("opened"); }
    else { puts("denied"); return 1; }
  } else if (strcmp(argv[1], "loop") == 0) {
    volatile unsigned int value = 0;
    for (;;) value++;
  } else if (strcmp(argv[1], "grow") == 0) {
#if defined(__wasm__)
    puts(__builtin_wasm_memory_grow(0, 32768) == (size_t)-1 ? "bounded" : "grew");
#endif
  } else if (strcmp(argv[1], "exit") == 0) {
    return atoi(argv[2]);
  } else { fputs("unknown command\n", stderr); return 2; }
  return 0;
}
