const fs = require('fs');
const path = require('path');
const readline = require('readline');

const file = process.argv[2];
if (!file) { console.error('Usage: node run.js <file.thi>'); process.exit(1); }
if (!fs.existsSync(file)) { console.error(`File not found: ${file}`); process.exit(1); }

const src = fs.readFileSync(file, 'utf8');

function timestamp() { return `[${new Date().toISOString()}]`; }

function err(lineNum, msg) {
  console.error(`[Error] line ${lineNum}: ${msg}`);
  process.exit(1);
}

function tokenize(raw, lineNum) {
  const tokens = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === ' ' || raw[i] === '\t') { i++; continue; }

    if (raw[i] === '"' || raw[i] === "'") {
      const q = raw[i++]; let s = '';
      while (i < raw.length && raw[i] !== q) {
        if (raw[i] === '\\' && i + 1 < raw.length) {
          i++;
          if (raw[i] === 'n') s += '\n';
          else if (raw[i] === 't') s += '\t';
          else s += raw[i];
          i++;
        } else {
          s += raw[i++];
        }
      }
      if (i >= raw.length) err(lineNum, `unterminated string`);
      i++;
      tokens.push({ type: 'string', value: s });
      continue;
    }
    if (i + 1 < raw.length) {
      const two = raw[i] + raw[i + 1];
      if (['==', '!=', '<=', '>='].includes(two)) {
        tokens.push({ type: 'op', value: two }); i += 2; continue;
      }
    }
    if (raw[i] === '-' && /\d/.test(raw[i + 1]) &&
        (!tokens.length || tokens[tokens.length - 1].type === 'op')) {
      let n = '-'; i++;
      while (i < raw.length && /[\d.]/.test(raw[i])) n += raw[i++];
      tokens.push({ type: 'number', value: parseFloat(n) });
      continue;
    }
    if (/\d/.test(raw[i])) {
      let n = '';
      while (i < raw.length && /[\d.]/.test(raw[i])) n += raw[i++];
      tokens.push({ type: 'number', value: parseFloat(n) });
      continue;
    }
    if (/[a-zA-Z_]/.test(raw[i])) {
      let w = '';
      while (i < raw.length && /[a-zA-Z0-9_]/.test(raw[i])) w += raw[i++];
      tokens.push({ type: 'word', value: w });
      continue;
    }
    if (['+', '-', '*', '/', '(', ')', ',', '=', ';', '<', '>'].includes(raw[i])) {
      tokens.push({ type: 'op', value: raw[i++] });
      continue;
    }
    err(lineNum, `illegal character: '${raw[i]}'`);
  }
  return tokens;
}

function splitStatements(tokens, lineNum) {
  const stmts = [[]];
  for (const t of tokens) {
    if (t.type === 'op' && t.value === ';') stmts.push([]);
    else stmts[stmts.length - 1].push(t);
  }
  return stmts.filter(s => s.length).map(toks => ({ tokens: toks, lineNum }));
}

const CMP_OPS  = ['==', '!=', '<', '>', '<=', '>='];
const ADD_OPS  = ['+', '-'];
const MUL_OPS  = ['*', '/'];

async function parseExpr(tokens, pos, ctx, lineNum) {
  return parseComparison(tokens, pos, ctx, lineNum);
}

async function parseComparison(tokens, pos, ctx, lineNum) {
  let [left, p] = await parseAdditive(tokens, pos, ctx, lineNum);
  if (p < tokens.length && tokens[p]?.type === 'op' && CMP_OPS.includes(tokens[p].value)) {
    const op = tokens[p].value;
    const [right, p2] = await parseAdditive(tokens, p + 1, ctx, lineNum);
    const result = applyComparison(op, left, right);
    return [result, p2];
  }
  return [left, p];
}

function applyComparison(op, l, r) {
  if (op === '==') return l === r ? 1 : 0;
  if (op === '!=') return l !== r ? 1 : 0;
  if (op === '<')  return l <   r ? 1 : 0;
  if (op === '>')  return l >   r ? 1 : 0;
  if (op === '<=') return l <=  r ? 1 : 0;
  if (op === '>=') return l >=  r ? 1 : 0;
}

async function parseAdditive(tokens, pos, ctx, lineNum) {
  let [left, p] = await parseMultiplicative(tokens, pos, ctx, lineNum);
  while (p < tokens.length && tokens[p]?.type === 'op' && ADD_OPS.includes(tokens[p].value)) {
    const op = tokens[p].value;
    const [right, p2] = await parseMultiplicative(tokens, p + 1, ctx, lineNum);
    if (op === '+') left = (typeof left === 'number' && typeof right === 'number')
      ? left + right : String(left) + String(right);
    else left = left - right;
    p = p2;
  }
  return [left, p];
}

async function parseMultiplicative(tokens, pos, ctx, lineNum) {
  let [left, p] = await parsePrimary(tokens, pos, ctx, lineNum);
  while (p < tokens.length && tokens[p]?.type === 'op' && MUL_OPS.includes(tokens[p].value)) {
    const op = tokens[p].value;
    const [right, p2] = await parsePrimary(tokens, p + 1, ctx, lineNum);
    if (op === '*') left = left * right;
    else {
      if (right === 0) err(lineNum, `division by zero`);
      left = left / right;
    }
    p = p2;
  }
  return [left, p];
}

async function parsePrimary(tokens, pos, ctx, lineNum) {
  const t = tokens[pos];
  if (!t) err(lineNum, `unexpected end of expression`);

  if (t.type === 'op' && t.value === '(') {
    const [val, p] = await parseExpr(tokens, pos + 1, ctx, lineNum);
    if (tokens[p]?.value !== ')') err(lineNum, `missing closing ')'`);
    return [val, p + 1];
  }

  if (t.type === 'number') return [t.value, pos + 1];
  if (t.type === 'string') return [t.value, pos + 1];

  if (t.type === 'word') {
    if (tokens[pos + 1]?.value === '(') {
      if (ctx.userFns[t.value]) {
        return callUserFn(t.value, tokens, pos, ctx, lineNum);
      }
      const fn = ctx.fns[t.value];
      if (!fn) err(lineNum, `unknown function: ${t.value}`);
      const [args, p] = await parseArgList(tokens, pos + 2, ctx, lineNum, t.value);
      const res = await fn(args);
      return [res, p];
    }
    if (!(t.value in ctx.vars)) err(lineNum, `undefined variable: ${t.value}`);
    return [ctx.vars[t.value], pos + 1];
  }

  err(lineNum, `unexpected token: '${t.value}'`);
}

async function parseArgList(tokens, pos, ctx, lineNum, fnName) {
  const args = []; let p = pos;
  while (p < tokens.length && tokens[p]?.value !== ')') {
    if (tokens[p]?.value === ',') { p++; continue; }
    const [val, p2] = await parseExpr(tokens, p, ctx, lineNum);
    args.push(val); p = p2;
    if (tokens[p]?.value !== ')' && tokens[p]?.value !== ',')
      err(lineNum, `expected ',' or ')' after argument in call to '${fnName}'`);
  }
  if (tokens[p]?.value !== ')') err(lineNum, `missing closing ')' in call to '${fnName}'`);
  return [args, p + 1];
}

async function callUserFn(name, tokens, pos, ctx, lineNum) {
  const def = ctx.userFns[name];
  const [args, p] = await parseArgList(tokens, pos + 2, ctx, lineNum, name);
  if (args.length !== def.params.length)
    err(lineNum, `function '${name}' expects ${def.params.length} argument(s), got ${args.length}`);

  const localCtx = {
    vars: {},
    fns: ctx.fns,
    userFns: ctx.userFns,
  };
  def.params.forEach((param, i) => { localCtx.vars[param] = args[i]; });

  const result = await runBlock(def.body, localCtx);
  const retVal = (result && result.type === 'return') ? result.value : null;
  return [retVal, p];
}

async function runBlock(stmts, ctx) {
  for (const stmt of stmts) {
    const signal = await execNode(stmt, ctx);
    if (signal) return signal; 
  }
  return null;
}

async function runStatement(tokens, lineNum, ctx) {
  if (!tokens.length) return null;
  const kw = tokens[0].type === 'word' ? tokens[0].value : null;

  if (kw === 'return') {
    if (tokens.length === 1) return { type: 'return', value: null };
    const [val] = await parseExpr(tokens, 1, ctx, lineNum);
    return { type: 'return', value: val };
  }

  if (kw === 'break') return { type: 'break' };

  if (tokens[0].type === 'word' && tokens[1]?.value === '=' && tokens[1]?.type === 'op'
      && !['=='].includes(tokens[1]?.value)) {
    // make sure it's a plain '=' not '=='
    if (tokens[1].value === '=') {
      const name = tokens[0].value;
      if (ctx.userFns[name]) err(lineNum, `cannot use function name as variable: ${name}`);
      if (ctx.fns[name])     err(lineNum, `cannot use function name as variable: ${name}`);
      const [val] = await parseExpr(tokens, 2, ctx, lineNum);
      ctx.vars[name] = val;
      return null;
    }
  }

  if (kw && tokens[1]?.value === '(') {
    await parseExpr(tokens, 0, ctx, lineNum);
    return null;
  }

  err(lineNum, `unrecognised statement: '${tokens.map(t => t.value).join(' ')}'`);
}
const KEYWORDS = new Set(['if','elif','else','end','while','fn','return','break','import']);

function parseAllLines(rawLines) {
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1;
    const line = rawLines[i].split('#')[0].trim();
    if (!line) continue;
    const tokens = tokenize(line, lineNum);
    if (!tokens.length) continue;
    const stmts = splitStatements(tokens, lineNum);
    for (const s of stmts) lines.push(s);
  }
  // now parse into a tree
  const [stmts, end] = parseBlock(lines, 0, null);
  if (end < lines.length) {
    const extra = lines[end];
    err(extra.lineNum, `unexpected '${extra.tokens[0].value}' without matching block opener`);
  }
  return stmts;
}

function parseBlock(lines, start, stopAt) {
  const stmts = [];
  let i = start;

  while (i < lines.length) {
    const { tokens, lineNum } = lines[i];
    const kw = tokens[0]?.type === 'word' ? tokens[0].value : null;

    // terminators
    if (kw === 'end' || kw === 'elif' || kw === 'else') {
      if (stopAt === null) {
        err(lineNum, `unexpected '${kw}'`);
      }
      return [stmts, i];
    }

    // import (only valid at top level, enforced later)
    if (kw === 'import') {
      stmts.push({ type: 'import', tokens, lineNum });
      i++; continue;
    }

    // fn definition
    if (kw === 'fn') {
      if (tokens.length < 2 || tokens[1].type !== 'word')
        err(lineNum, `fn expects a function name`);
      const name = tokens[1].value;
      if (KEYWORDS.has(name)) err(lineNum, `cannot use keyword '${name}' as function name`);
      // parse parameter list: fn name(a, b, c)
      const params = [];
      if (tokens[2]?.value !== '(') err(lineNum, `expected '(' after function name`);
      let p = 3;
      while (p < tokens.length && tokens[p]?.value !== ')') {
        if (tokens[p]?.value === ',') { p++; continue; }
        if (tokens[p].type !== 'word') err(lineNum, `expected parameter name`);
        params.push(tokens[p].value); p++;
      }
      if (tokens[p]?.value !== ')') err(lineNum, `missing ')' in fn definition`);
      i++;
      const [body, end] = parseBlock(lines, i, 'end');
      if (lines[end]?.tokens[0]?.value !== 'end')
        err(lineNum, `fn '${name}' missing 'end'`);
      stmts.push({ type: 'fn', name, params, body, lineNum });
      i = end + 1; continue;
    }

    // if statement
    if (kw === 'if') {
      const condTokens = tokens.slice(1);
      if (!condTokens.length) err(lineNum, `if expects a condition`);
      i++;
      const branches = [];

      // parse the 'if' body
      let [body, end] = parseBlock(lines, i, 'end');
      branches.push({ condTokens, body });
      i = end;

      // parse any elif / else
      while (i < lines.length) {
        const bkw = lines[i].tokens[0]?.value;
        if (bkw === 'elif') {
          const elifCond = lines[i].tokens.slice(1);
          if (!elifCond.length) err(lines[i].lineNum, `elif expects a condition`);
          const elifLineNum = lines[i].lineNum;
          i++;
          const [elifBody, elifEnd] = parseBlock(lines, i, 'end');
          branches.push({ condTokens: elifCond, body: elifBody, lineNum: elifLineNum });
          i = elifEnd;
        } else if (bkw === 'else') {
          const elseLineNum = lines[i].lineNum;
          i++;
          const [elseBody, elseEnd] = parseBlock(lines, i, 'end');
          branches.push({ condTokens: null, body: elseBody, lineNum: elseLineNum });
          i = elseEnd;
        } else {
          break;
        }
      }

      if (lines[i]?.tokens[0]?.value !== 'end')
        err(lineNum, `if missing 'end'`);
      stmts.push({ type: 'if', branches, lineNum });
      i++; continue;
    }

    // while loop
    if (kw === 'while') {
      const condTokens = tokens.slice(1);
      if (!condTokens.length) err(lineNum, `while expects a condition`);
      i++;
      const [body, end] = parseBlock(lines, i, 'end');
      if (lines[end]?.tokens[0]?.value !== 'end')
        err(lineNum, `while missing 'end'`);
      stmts.push({ type: 'while', condTokens, body, lineNum });
      i = end + 1; continue;
    }

    // plain statement
    stmts.push({ type: 'stmt', tokens, lineNum });
    i++;
  }

  return [stmts, i];
}

async function execNode(node, ctx) {
  if (node.type === 'import') {
    return execImport(node, ctx);
  }

  if (node.type === 'fn') {
    if (ctx.fns[node.name]) err(node.lineNum, `cannot use built-in name as function: ${node.name}`);
    ctx.userFns[node.name] = { params: node.params, body: node.body };
    return null;
  }

  if (node.type === 'if') {
    for (const branch of node.branches) {
      let condVal = 1;
      if (branch.condTokens !== null) {
        const [v] = await parseExpr(branch.condTokens, 0, ctx, node.lineNum);
        condVal = v;
      }
      if (condVal) {
        return runBlock(branch.body, ctx);
      }
    }
    return null;
  }

  if (node.type === 'while') {
    while (true) {
      const [condVal] = await parseExpr(node.condTokens, 0, ctx, node.lineNum);
      if (!condVal) break;
      const signal = await runBlock(node.body, ctx);
      if (signal?.type === 'break')  break;
      if (signal?.type === 'return') return signal;
    }
    return null;
  }

  if (node.type === 'stmt') {
    return runStatement(node.tokens, node.lineNum, ctx);
  }
}

async function execImport(node, ctx) {
  const tokens = node.tokens;
  if (tokens.length < 2 || tokens[1].type !== 'word')
    err(node.lineNum, `import expects a module name`);
  const mod = tokens[1].value;
  if (/^_/.test(mod)) err(node.lineNum, `illegal module name: '${mod}' (names starting with '_' are reserved)`);
  const modPath = path.join(__dirname, 'modules', `${mod}.js`);
  if (!fs.existsSync(modPath)) err(node.lineNum, `module not found: '${mod}'`);
  let m;
  try { m = require(modPath); }
  catch (e) { err(node.lineNum, `failed to load module '${mod}': ${e.message}`); }
  if (m.init) await m.init(ctx);
  if (m.fns) Object.assign(ctx.fns, m.fns);
  return null;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(res => rl.question(q, res)); }

async function run() {
  const ctx = {
    vars: {},
    fns: {
      out:    ([v])    => { process.stdout.write(`${timestamp()} ${v ?? ''}\n`); return null; },
      prompt: async ([msg]) => ask(msg ?? ''),
      str:    ([v])    => String(v ?? ''),
      num:    ([v])    => parseFloat(v) || 0,
      len:    ([v])    => String(v ?? '').length,
    },
    userFns: {},
  };

  const rawLines = src.split('\n');
  const tree = parseAllLines(rawLines);

  let seenNonImport = false;
  for (const node of tree) {
    if (node.type === 'import') {
      if (seenNonImport) err(node.lineNum, `imports must appear before any statements`);
    } else {
      seenNonImport = true;
    }
  }

  for (const node of tree) {
    const signal = await execNode(node, ctx);
    if (signal?.type === 'return') err(node.lineNum, `return outside of function`);
    if (signal?.type === 'break')  err(node.lineNum, `break outside of loop`);
  }

  rl.close();
}

run().catch(e => { console.error(e.message); process.exit(1); });
