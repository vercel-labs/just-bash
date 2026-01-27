function extend(destination) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];
    for (var key in source) {
      if (source.hasOwnProperty(key)) destination[key] = source[key];
    }
  }
  return destination;
}
function repeat(character, count) {
  return Array(count + 1).join(character);
}
function trimLeadingNewlines(string) {
  return string.replace(/^\n*/, "");
}
function trimTrailingNewlines(string) {
  var indexEnd = string.length;
  while (indexEnd > 0 && string[indexEnd - 1] === "\n") indexEnd--;
  return string.substring(0, indexEnd);
}
function trimNewlines(string) {
  return trimTrailingNewlines(trimLeadingNewlines(string));
}
var blockElements = [
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "AUDIO",
  "BLOCKQUOTE",
  "BODY",
  "CANVAS",
  "CENTER",
  "DD",
  "DIR",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "FRAMESET",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HGROUP",
  "HR",
  "HTML",
  "ISINDEX",
  "LI",
  "MAIN",
  "MENU",
  "NAV",
  "NOFRAMES",
  "NOSCRIPT",
  "OL",
  "OUTPUT",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL"
];
function isBlock(node) {
  return is(node, blockElements);
}
var voidElements = [
  "AREA",
  "BASE",
  "BR",
  "COL",
  "COMMAND",
  "EMBED",
  "HR",
  "IMG",
  "INPUT",
  "KEYGEN",
  "LINK",
  "META",
  "PARAM",
  "SOURCE",
  "TRACK",
  "WBR"
];
function isVoid(node) {
  return is(node, voidElements);
}
function hasVoid(node) {
  return has(node, voidElements);
}
var meaningfulWhenBlankElements = [
  "A",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TH",
  "TD",
  "IFRAME",
  "SCRIPT",
  "AUDIO",
  "VIDEO"
];
function isMeaningfulWhenBlank(node) {
  return is(node, meaningfulWhenBlankElements);
}
function hasMeaningfulWhenBlank(node) {
  return has(node, meaningfulWhenBlankElements);
}
function is(node, tagNames) {
  return tagNames.indexOf(node.nodeName) >= 0;
}
function has(node, tagNames) {
  return node.getElementsByTagName && tagNames.some(function(tagName) {
    return node.getElementsByTagName(tagName).length;
  });
}
var rules = {};
rules.paragraph = {
  filter: "p",
  replacement: function(content) {
    return "\n\n" + content + "\n\n";
  }
};
rules.lineBreak = {
  filter: "br",
  replacement: function(content, node, options) {
    return options.br + "\n";
  }
};
rules.heading = {
  filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
  replacement: function(content, node, options) {
    var hLevel = Number(node.nodeName.charAt(1));
    if (options.headingStyle === "setext" && hLevel < 3) {
      var underline = repeat(hLevel === 1 ? "=" : "-", content.length);
      return "\n\n" + content + "\n" + underline + "\n\n";
    } else {
      return "\n\n" + repeat("#", hLevel) + " " + content + "\n\n";
    }
  }
};
rules.blockquote = {
  filter: "blockquote",
  replacement: function(content) {
    content = trimNewlines(content).replace(/^/gm, "> ");
    return "\n\n" + content + "\n\n";
  }
};
rules.list = {
  filter: ["ul", "ol"],
  replacement: function(content, node) {
    var parent = node.parentNode;
    if (parent.nodeName === "LI" && parent.lastElementChild === node) {
      return "\n" + content;
    } else {
      return "\n\n" + content + "\n\n";
    }
  }
};
rules.listItem = {
  filter: "li",
  replacement: function(content, node, options) {
    var prefix = options.bulletListMarker + "   ";
    var parent = node.parentNode;
    if (parent.nodeName === "OL") {
      var start = parent.getAttribute("start");
      var index = Array.prototype.indexOf.call(parent.children, node);
      prefix = (start ? Number(start) + index : index + 1) + ".  ";
    }
    var isParagraph = /\n$/.test(content);
    content = trimNewlines(content) + (isParagraph ? "\n" : "");
    content = content.replace(/\n/gm, "\n" + " ".repeat(prefix.length));
    return prefix + content + (node.nextSibling ? "\n" : "");
  }
};
rules.indentedCodeBlock = {
  filter: function(node, options) {
    return options.codeBlockStyle === "indented" && node.nodeName === "PRE" && node.firstChild && node.firstChild.nodeName === "CODE";
  },
  replacement: function(content, node, options) {
    return "\n\n    " + node.firstChild.textContent.replace(/\n/g, "\n    ") + "\n\n";
  }
};
rules.fencedCodeBlock = {
  filter: function(node, options) {
    return options.codeBlockStyle === "fenced" && node.nodeName === "PRE" && node.firstChild && node.firstChild.nodeName === "CODE";
  },
  replacement: function(content, node, options) {
    var className = node.firstChild.getAttribute("class") || "";
    var language = (className.match(/language-(\S+)/) || [null, ""])[1];
    var code = node.firstChild.textContent;
    var fenceChar = options.fence.charAt(0);
    var fenceSize = 3;
    var fenceInCodeRegex = new RegExp("^" + fenceChar + "{3,}", "gm");
    var match;
    while (match = fenceInCodeRegex.exec(code)) {
      if (match[0].length >= fenceSize) {
        fenceSize = match[0].length + 1;
      }
    }
    var fence = repeat(fenceChar, fenceSize);
    return "\n\n" + fence + language + "\n" + code.replace(/\n$/, "") + "\n" + fence + "\n\n";
  }
};
rules.horizontalRule = {
  filter: "hr",
  replacement: function(content, node, options) {
    return "\n\n" + options.hr + "\n\n";
  }
};
rules.inlineLink = {
  filter: function(node, options) {
    return options.linkStyle === "inlined" && node.nodeName === "A" && node.getAttribute("href");
  },
  replacement: function(content, node) {
    var href = node.getAttribute("href");
    if (href) href = href.replace(/([()])/g, "\\$1");
    var title = cleanAttribute(node.getAttribute("title"));
    if (title) title = ' "' + title.replace(/"/g, '\\"') + '"';
    return "[" + content + "](" + href + title + ")";
  }
};
rules.referenceLink = {
  filter: function(node, options) {
    return options.linkStyle === "referenced" && node.nodeName === "A" && node.getAttribute("href");
  },
  replacement: function(content, node, options) {
    var href = node.getAttribute("href");
    var title = cleanAttribute(node.getAttribute("title"));
    if (title) title = ' "' + title + '"';
    var replacement;
    var reference;
    switch (options.linkReferenceStyle) {
      case "collapsed":
        replacement = "[" + content + "][]";
        reference = "[" + content + "]: " + href + title;
        break;
      case "shortcut":
        replacement = "[" + content + "]";
        reference = "[" + content + "]: " + href + title;
        break;
      default:
        var id = this.references.length + 1;
        replacement = "[" + content + "][" + id + "]";
        reference = "[" + id + "]: " + href + title;
    }
    this.references.push(reference);
    return replacement;
  },
  references: [],
  append: function(options) {
    var references = "";
    if (this.references.length) {
      references = "\n\n" + this.references.join("\n") + "\n\n";
      this.references = [];
    }
    return references;
  }
};
rules.emphasis = {
  filter: ["em", "i"],
  replacement: function(content, node, options) {
    if (!content.trim()) return "";
    return options.emDelimiter + content + options.emDelimiter;
  }
};
rules.strong = {
  filter: ["strong", "b"],
  replacement: function(content, node, options) {
    if (!content.trim()) return "";
    return options.strongDelimiter + content + options.strongDelimiter;
  }
};
rules.code = {
  filter: function(node) {
    var hasSiblings = node.previousSibling || node.nextSibling;
    var isCodeBlock = node.parentNode.nodeName === "PRE" && !hasSiblings;
    return node.nodeName === "CODE" && !isCodeBlock;
  },
  replacement: function(content) {
    if (!content) return "";
    content = content.replace(/\r?\n|\r/g, " ");
    var extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? " " : "";
    var delimiter = "`";
    var matches = content.match(/`+/gm) || [];
    while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + "`";
    return delimiter + extraSpace + content + extraSpace + delimiter;
  }
};
rules.image = {
  filter: "img",
  replacement: function(content, node) {
    var alt = cleanAttribute(node.getAttribute("alt"));
    var src = node.getAttribute("src") || "";
    var title = cleanAttribute(node.getAttribute("title"));
    var titlePart = title ? ' "' + title + '"' : "";
    return src ? "![" + alt + "](" + src + titlePart + ")" : "";
  }
};
function cleanAttribute(attribute) {
  return attribute ? attribute.replace(/(\n+\s*)+/g, "\n") : "";
}
function Rules(options) {
  this.options = options;
  this._keep = [];
  this._remove = [];
  this.blankRule = {
    replacement: options.blankReplacement
  };
  this.keepReplacement = options.keepReplacement;
  this.defaultRule = {
    replacement: options.defaultReplacement
  };
  this.array = [];
  for (var key in options.rules) this.array.push(options.rules[key]);
}
Rules.prototype = {
  add: function(key, rule) {
    this.array.unshift(rule);
  },
  keep: function(filter) {
    this._keep.unshift({
      filter,
      replacement: this.keepReplacement
    });
  },
  remove: function(filter) {
    this._remove.unshift({
      filter,
      replacement: function() {
        return "";
      }
    });
  },
  forNode: function(node) {
    if (node.isBlank) return this.blankRule;
    var rule;
    if (rule = findRule(this.array, node, this.options)) return rule;
    if (rule = findRule(this._keep, node, this.options)) return rule;
    if (rule = findRule(this._remove, node, this.options)) return rule;
    return this.defaultRule;
  },
  forEach: function(fn) {
    for (var i = 0; i < this.array.length; i++) fn(this.array[i], i);
  }
};
function findRule(rules2, node, options) {
  for (var i = 0; i < rules2.length; i++) {
    var rule = rules2[i];
    if (filterValue(rule, node, options)) return rule;
  }
  return void 0;
}
function filterValue(rule, node, options) {
  var filter = rule.filter;
  if (typeof filter === "string") {
    if (filter === node.nodeName.toLowerCase()) return true;
  } else if (Array.isArray(filter)) {
    if (filter.indexOf(node.nodeName.toLowerCase()) > -1) return true;
  } else if (typeof filter === "function") {
    if (filter.call(rule, node, options)) return true;
  } else {
    throw new TypeError("`filter` needs to be a string, array, or function");
  }
}
function collapseWhitespace(options) {
  var element = options.element;
  var isBlock2 = options.isBlock;
  var isVoid2 = options.isVoid;
  var isPre = options.isPre || function(node2) {
    return node2.nodeName === "PRE";
  };
  if (!element.firstChild || isPre(element)) return;
  var prevText = null;
  var keepLeadingWs = false;
  var prev = null;
  var node = next(prev, element, isPre);
  while (node !== element) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      var text = node.data.replace(/[ \r\n\t]+/g, " ");
      if ((!prevText || / $/.test(prevText.data)) && !keepLeadingWs && text[0] === " ") {
        text = text.substr(1);
      }
      if (!text) {
        node = remove(node);
        continue;
      }
      node.data = text;
      prevText = node;
    } else if (node.nodeType === 1) {
      if (isBlock2(node) || node.nodeName === "BR") {
        if (prevText) {
          prevText.data = prevText.data.replace(/ $/, "");
        }
        prevText = null;
        keepLeadingWs = false;
      } else if (isVoid2(node) || isPre(node)) {
        prevText = null;
        keepLeadingWs = true;
      } else if (prevText) {
        keepLeadingWs = false;
      }
    } else {
      node = remove(node);
      continue;
    }
    var nextNode = next(prev, node, isPre);
    prev = node;
    node = nextNode;
  }
  if (prevText) {
    prevText.data = prevText.data.replace(/ $/, "");
    if (!prevText.data) {
      remove(prevText);
    }
  }
}
function remove(node) {
  var next2 = node.nextSibling || node.parentNode;
  node.parentNode.removeChild(node);
  return next2;
}
function next(prev, current, isPre) {
  if (prev && prev.parentNode === current || isPre(current)) {
    return current.nextSibling || current.parentNode;
  }
  return current.firstChild || current.nextSibling || current.parentNode;
}
var root = typeof window !== "undefined" ? window : {};
function canParseHTMLNatively() {
  var Parser = root.DOMParser;
  var canParse = false;
  try {
    if (new Parser().parseFromString("", "text/html")) {
      canParse = true;
    }
  } catch (e) {
  }
  return canParse;
}
function createHTMLParser() {
  var Parser = function() {
  };
  {
    var domino = require("@mixmark-io/domino");
    Parser.prototype.parseFromString = function(string) {
      return domino.createDocument(string);
    };
  }
  return Parser;
}
var HTMLParser = canParseHTMLNatively() ? root.DOMParser : createHTMLParser();
function RootNode(input, options) {
  var root2;
  if (typeof input === "string") {
    var doc = htmlParser().parseFromString(
      // DOM parsers arrange elements in the <head> and <body>.
      // Wrapping in a custom element ensures elements are reliably arranged in
      // a single element.
      '<x-turndown id="turndown-root">' + input + "</x-turndown>",
      "text/html"
    );
    root2 = doc.getElementById("turndown-root");
  } else {
    root2 = input.cloneNode(true);
  }
  collapseWhitespace({
    element: root2,
    isBlock,
    isVoid,
    isPre: options.preformattedCode ? isPreOrCode : null
  });
  return root2;
}
var _htmlParser;
function htmlParser() {
  _htmlParser = _htmlParser || new HTMLParser();
  return _htmlParser;
}
function isPreOrCode(node) {
  return node.nodeName === "PRE" || node.nodeName === "CODE";
}
function Node(node, options) {
  node.isBlock = isBlock(node);
  node.isCode = node.nodeName === "CODE" || node.parentNode.isCode;
  node.isBlank = isBlank(node);
  node.flankingWhitespace = flankingWhitespace(node, options);
  return node;
}
function isBlank(node) {
  return !isVoid(node) && !isMeaningfulWhenBlank(node) && /^\s*$/i.test(node.textContent) && !hasVoid(node) && !hasMeaningfulWhenBlank(node);
}
function flankingWhitespace(node, options) {
  if (node.isBlock || options.preformattedCode && node.isCode) {
    return { leading: "", trailing: "" };
  }
  var edges = edgeWhitespace(node.textContent);
  if (edges.leadingAscii && isFlankedByWhitespace("left", node, options)) {
    edges.leading = edges.leadingNonAscii;
  }
  if (edges.trailingAscii && isFlankedByWhitespace("right", node, options)) {
    edges.trailing = edges.trailingNonAscii;
  }
  return { leading: edges.leading, trailing: edges.trailing };
}
function edgeWhitespace(string) {
  var m = string.match(/^(([ \t\r\n]*)(\s*))(?:(?=\S)[\s\S]*\S)?((\s*?)([ \t\r\n]*))$/);
  return {
    leading: m[1],
    // whole string for whitespace-only strings
    leadingAscii: m[2],
    leadingNonAscii: m[3],
    trailing: m[4],
    // empty for whitespace-only strings
    trailingNonAscii: m[5],
    trailingAscii: m[6]
  };
}
function isFlankedByWhitespace(side, node, options) {
  var sibling;
  var regExp;
  var isFlanked;
  if (side === "left") {
    sibling = node.previousSibling;
    regExp = / $/;
  } else {
    sibling = node.nextSibling;
    regExp = /^ /;
  }
  if (sibling) {
    if (sibling.nodeType === 3) {
      isFlanked = regExp.test(sibling.nodeValue);
    } else if (options.preformattedCode && sibling.nodeName === "CODE") {
      isFlanked = false;
    } else if (sibling.nodeType === 1 && !isBlock(sibling)) {
      isFlanked = regExp.test(sibling.textContent);
    }
  }
  return isFlanked;
}
var reduce = Array.prototype.reduce;
var escapes = [
  [/\\/g, "\\\\"],
  [/\*/g, "\\*"],
  [/^-/g, "\\-"],
  [/^\+ /g, "\\+ "],
  [/^(=+)/g, "\\$1"],
  [/^(#{1,6}) /g, "\\$1 "],
  [/`/g, "\\`"],
  [/^~~~/g, "\\~~~"],
  [/\[/g, "\\["],
  [/\]/g, "\\]"],
  [/^>/g, "\\>"],
  [/_/g, "\\_"],
  [/^(\d+)\. /g, "$1\\. "]
];
function TurndownService(options) {
  if (!(this instanceof TurndownService)) return new TurndownService(options);
  var defaults = {
    rules,
    headingStyle: "setext",
    hr: "* * *",
    bulletListMarker: "*",
    codeBlockStyle: "indented",
    fence: "```",
    emDelimiter: "_",
    strongDelimiter: "**",
    linkStyle: "inlined",
    linkReferenceStyle: "full",
    br: "  ",
    preformattedCode: false,
    blankReplacement: function(content, node) {
      return node.isBlock ? "\n\n" : "";
    },
    keepReplacement: function(content, node) {
      return node.isBlock ? "\n\n" + node.outerHTML + "\n\n" : node.outerHTML;
    },
    defaultReplacement: function(content, node) {
      return node.isBlock ? "\n\n" + content + "\n\n" : content;
    }
  };
  this.options = extend({}, defaults, options);
  this.rules = new Rules(this.options);
}
TurndownService.prototype = {
  /**
   * The entry point for converting a string or DOM node to Markdown
   * @public
   * @param {String|HTMLElement} input The string or DOM node to convert
   * @returns A Markdown representation of the input
   * @type String
   */
  turndown: function(input) {
    if (!canConvert(input)) {
      throw new TypeError(
        input + " is not a string, or an element/document/fragment node."
      );
    }
    if (input === "") return "";
    var output = process.call(this, new RootNode(input, this.options));
    return postProcess.call(this, output);
  },
  /**
   * Add one or more plugins
   * @public
   * @param {Function|Array} plugin The plugin or array of plugins to add
   * @returns The Turndown instance for chaining
   * @type Object
   */
  use: function(plugin) {
    if (Array.isArray(plugin)) {
      for (var i = 0; i < plugin.length; i++) this.use(plugin[i]);
    } else if (typeof plugin === "function") {
      plugin(this);
    } else {
      throw new TypeError("plugin must be a Function or an Array of Functions");
    }
    return this;
  },
  /**
   * Adds a rule
   * @public
   * @param {String} key The unique key of the rule
   * @param {Object} rule The rule
   * @returns The Turndown instance for chaining
   * @type Object
   */
  addRule: function(key, rule) {
    this.rules.add(key, rule);
    return this;
  },
  /**
   * Keep a node (as HTML) that matches the filter
   * @public
   * @param {String|Array|Function} filter The unique key of the rule
   * @returns The Turndown instance for chaining
   * @type Object
   */
  keep: function(filter) {
    this.rules.keep(filter);
    return this;
  },
  /**
   * Remove a node that matches the filter
   * @public
   * @param {String|Array|Function} filter The unique key of the rule
   * @returns The Turndown instance for chaining
   * @type Object
   */
  remove: function(filter) {
    this.rules.remove(filter);
    return this;
  },
  /**
   * Escapes Markdown syntax
   * @public
   * @param {String} string The string to escape
   * @returns A string with Markdown syntax escaped
   * @type String
   */
  escape: function(string) {
    return escapes.reduce(function(accumulator, escape) {
      return accumulator.replace(escape[0], escape[1]);
    }, string);
  }
};
function process(parentNode) {
  var self = this;
  return reduce.call(parentNode.childNodes, function(output, node) {
    node = new Node(node, self.options);
    var replacement = "";
    if (node.nodeType === 3) {
      replacement = node.isCode ? node.nodeValue : self.escape(node.nodeValue);
    } else if (node.nodeType === 1) {
      replacement = replacementForNode.call(self, node);
    }
    return join(output, replacement);
  }, "");
}
function postProcess(output) {
  var self = this;
  this.rules.forEach(function(rule) {
    if (typeof rule.append === "function") {
      output = join(output, rule.append(self.options));
    }
  });
  return output.replace(/^[\t\r\n]+/, "").replace(/[\t\r\n\s]+$/, "");
}
function replacementForNode(node) {
  var rule = this.rules.forNode(node);
  var content = process.call(this, node);
  var whitespace = node.flankingWhitespace;
  if (whitespace.leading || whitespace.trailing) content = content.trim();
  return whitespace.leading + rule.replacement(content, node, this.options) + whitespace.trailing;
}
function join(output, replacement) {
  var s1 = trimTrailingNewlines(output);
  var s2 = trimLeadingNewlines(replacement);
  var nls = Math.max(output.length - s1.length, replacement.length - s2.length);
  var separator = "\n\n".substring(0, nls);
  return s1 + separator + s2;
}
function canConvert(input) {
  return input != null && (typeof input === "string" || input.nodeType && (input.nodeType === 1 || input.nodeType === 9 || input.nodeType === 11));
}
export {
  TurndownService as T
};
