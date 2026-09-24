// A freestanding WASM library: no main, _start, WASI, or libc.
// The adapter supplies the one custom import and calls the exported functions.
__attribute__((import_module("env"), import_name("rotation")))
extern unsigned int rotation(void);

static unsigned char buffer[65536];

unsigned int buffer_ptr(void) { return (unsigned int)(unsigned long)buffer; }
unsigned int buffer_capacity(void) { return sizeof(buffer); }

void transform(unsigned int length) {
  if (length > sizeof(buffer)) __builtin_trap();
  unsigned int shift = rotation() % 26;
  for (unsigned int i = 0; i < length; i++) {
    unsigned char c = buffer[i];
    if (c >= 'a' && c <= 'z') buffer[i] = 'a' + (c - 'a' + shift) % 26;
    else if (c >= 'A' && c <= 'Z') buffer[i] = 'A' + (c - 'A' + shift) % 26;
  }
}
