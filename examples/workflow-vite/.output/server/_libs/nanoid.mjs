const urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
function customRandom(alphabet, defaultSize, getRandom) {
  let mask = (2 << 31 - Math.clz32(alphabet.length - 1 | 1)) - 1;
  let step = Math.ceil(1.6 * mask * defaultSize / alphabet.length);
  return (size = defaultSize) => {
    if (!size) return "";
    let id = "";
    while (true) {
      let bytes = getRandom(step);
      let i = step;
      while (i--) {
        id += alphabet[bytes[i] & mask] || "";
        if (id.length >= size) return id;
      }
    }
  };
}
export {
  customRandom as c,
  urlAlphabet as u
};
