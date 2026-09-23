export class DuplicateCallbackJsonKeyError extends SyntaxError {
  constructor() {
    super('duplicate callback JSON key');
    this.name = 'DuplicateCallbackJsonKeyError';
  }
}

function createParser(text) {
  let index = 0;
  let depth = 0;

  function fail() {
    throw new SyntaxError('invalid callback JSON');
  }

  function whitespace() {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[index])) index += 1;
  }

  function stringValue() {
    if (text[index] !== '"') fail();
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === '"') {
        index += 1;
        try {
          // Only one isolated string token is delegated to JSON.parse. Objects
          // are parsed below, where decoded keys are checked before assignment.
          return JSON.parse(text.slice(start, index));
        } catch {
          fail();
        }
      }
      if (!escaped && character === '\\') escaped = true;
      else escaped = false;
      index += 1;
    }
    fail();
  }

  function numberValue() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
    if (!match) fail();
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail();
    return value;
  }

  function literal(token, value) {
    if (!text.startsWith(token, index)) fail();
    index += token.length;
    return value;
  }

  function nested(parse) {
    depth += 1;
    if (depth > 64) fail();
    try {
      return parse();
    } finally {
      depth -= 1;
    }
  }

  function arrayValue() {
    return nested(() => {
      index += 1;
      whitespace();
      const values = [];
      if (text[index] === ']') {
        index += 1;
        return values;
      }
      while (index < text.length) {
        values.push(value());
        whitespace();
        if (text[index] === ']') {
          index += 1;
          return values;
        }
        if (text[index] !== ',') fail();
        index += 1;
        whitespace();
      }
      fail();
    });
  }

  function objectValue() {
    return nested(() => {
      index += 1;
      whitespace();
      const result = Object.create(null);
      const keys = new Set();
      if (text[index] === '}') {
        index += 1;
        return result;
      }
      while (index < text.length) {
        const key = stringValue();
        if (keys.has(key)) throw new DuplicateCallbackJsonKeyError();
        keys.add(key);
        whitespace();
        if (text[index] !== ':') fail();
        index += 1;
        whitespace();
        result[key] = value();
        whitespace();
        if (text[index] === '}') {
          index += 1;
          return result;
        }
        if (text[index] !== ',') fail();
        index += 1;
        whitespace();
      }
      fail();
    });
  }

  function value() {
    whitespace();
    const character = text[index];
    if (character === '"') return stringValue();
    if (character === '{') return objectValue();
    if (character === '[') return arrayValue();
    if (character === 't') return literal('true', true);
    if (character === 'f') return literal('false', false);
    if (character === 'n') return literal('null', null);
    return numberValue();
  }

  return function parse() {
    if (typeof text !== 'string' || text.length === 0) fail();
    whitespace();
    const result = value();
    whitespace();
    if (index !== text.length) fail();
    return result;
  };
}

export function parseCallbackJsonRejectingDuplicateKeysV1(text) {
  return createParser(text)();
}
