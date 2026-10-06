## ปัญหา

feature flag `new-checkout` ควรเปิดให้บาง account และปิดสำหรับที่เหลือ ส่วน targeting เวอร์ชันแรกของมันเป็นโค้ด: `FlagService.isEnabled()` เช็กว่า account อยู่ในประเทศไทย และต้องอยู่บน plan pro หรือไม่ก็มีมากกว่าสิบ seat โดยใช้ `if` ซ้อนกัน วางอยู่ข้าง ๆ block หน้าตาคล้าย ๆ กันของ flag ตัวอื่นทุกตัว

แบบนี้ใช้ได้จนกว่ากฎจะเริ่มขยับ ฝ่าย Marketing อยากเพิ่มมาเลเซียและลดเกณฑ์จำนวน seat ลง การเปลี่ยนแต่ละครั้งแบบนี้คือการแก้โค้ดที่ต้องผ่าน review, CI และ deploy คนที่เป็นเจ้าของกฎเลยต้องรอ release ฝ่าย Sales อยากได้กฎอีกแบบให้ลูกค้ารายหนึ่งคือ Acme แต่ก็ไม่มีที่ให้ใส่: `if` ชุดเดียวรับใช้ลูกค้าทุกราย และกฎต่อลูกค้าหนึ่งรายก็หมายถึง branch ต่อลูกค้าหนึ่งรายใน service การย้ายค่าไปไว้ใน configuration ด้วย field อย่าง `countries` กับ `minSeats` ช่วยได้แค่จนกว่าจะมีคนต้องการการผสมเงื่อนไขที่ field พวกนั้นบอกไม่ได้ อย่าง `or` ที่อยู่ข้างใน `and`

สิ่งที่ทีมต้องการคือภาษาเล็ก ๆ สำหรับ targeting: กฎที่เขียนเป็นข้อความ เก็บไว้คู่กับ flag แก้ได้โดยไม่ต้อง deploy มีแยกต่อลูกค้าได้ถ้าจำเป็น และ service ก็ evaluate มันให้แต่ละ account

## ทำงานยังไง

Interpreter ให้โครงสร้างแต่ละแบบของภาษาเล็ก ๆ มี class ของตัวเอง ประโยคหนึ่งประโยคของภาษา ในที่นี้คือกฎ targeting หนึ่งข้อ จะกลายเป็น tree ของ object จาก class พวกนั้น และการ evaluate ประโยคก็คือการขอให้ root ของ tree ตีความตัวเองกับ context: node ข้างในแต่ละตัวถามลูกของมันแล้วรวมคำตอบ ส่วน leaf ก็อ่านสิ่งที่ต้องใช้จาก context ทาง Gamma, Helm, Johnson และ Vlissides อธิบายมันไว้ในกลุ่ม behavioural pattern ใน *Design Patterns* (1994) ตัวอย่างที่ใช้ตลอดในเล่มคือ regular expression และ sample code ของพวกเขา evaluate Boolean expression ที่ไปหาค่าตัวแปรจาก context คล้าย ๆ กับที่กฎในที่นี้ทำ

| ส่วนประกอบ | ใน diagram | หน้าที่ |
|---|---|---|
| **AbstractExpression** | `Expr` | ประกาศ `interpret(ctx)` เป็น operation เดียวที่ node ทุกตัวใน tree implement |
| **TerminalExpression** | `Equals`, `GreaterThan` | เป็น leaf มันเทียบ attribute หนึ่งตัวของ context กับ literal และไม่ได้ถือ expression อื่น |
| **NonterminalExpression** | `And`, `Or` | โครงสร้างที่ประกอบขึ้นจาก expression อื่น มันถือ operand ของตัวเองเป็น `Expr` ตีความพวกมัน แล้วรวมผลลัพธ์ |
| **Context** | attribute ของ account | สิ่งที่ประโยคถูก evaluate ด้วย ส่งลงไปตาม tree: ในที่นี้คือ `country`, `plan` และ `seats` |
| **Client** | `FlagService` | ได้ tree ของกฎมา (โดย parse ข้อความครั้งเดียว) แล้วเรียก `interpret(ctx)` บน root ของมันทุกครั้งที่เช็ก |

**Terminal expression กับ nonterminal expression** ชื่อพวกนี้มาจาก grammar โดยที่ terminal symbol คือ symbol ที่ไม่ถูกแตกย่อยลงไปอีก ส่วน nonterminal คือ symbol ที่นิยามด้วย symbol อื่น ใน tree ตัว terminal expression คือ leaf และ nonterminal expression คือ node ข้างใน การเปรียบเทียบเป็น leaf ในที่นี้ ถึงจะมีสามส่วนก็ตาม เพราะส่วนพวกนั้นคือชื่อกับ literal ไม่ใช่ expression ที่ซ้อนลงไปอีกชั้น ส่วน leaf ใหม่อย่าง `In(country, ['TH', 'MY'])` หรือ node ข้างในตัวใหม่อย่าง `Not` ก็คือ class เพิ่มอีกตัว

**จาก grammar เป็น class** grammar ใน diagram มีสามกฎ เพราะมันกำหนด precedence ไว้: `and` ผูกแน่นกว่า `or` ตัว `expr` เลยเป็น list ของ `term` ที่ต่อกันด้วย `or` และ `term` เป็น list ของ `factor` ที่ต่อกันด้วย `and` ใน tree ไม่มี node ของ `expr`, `term` หรือ `factor` แต่มีแค่หนึ่ง class ต่อหนึ่ง operation: `or` กลายเป็น `Or`, `and` กลายเป็น `And` และการเปรียบเทียบกลายเป็น `Equals` หรือ `GreaterThan` ส่วนวงเล็บกำหนดรูปร่างของ tree แล้วก็หายไป นี่คือความต่างระหว่าง parse tree ที่ตาม grammar ทุกอย่าง กับ abstract syntax tree ที่ pattern นี้ evaluate

**ตัว context** ทุกอย่างที่กฎอ่านมาจาก context และนี่แหละที่ทำให้ tree ตัวเดียว reuse ได้: diagram evaluate tree ตัวเดียวกันให้สาม account ในที่นี้ context คือ map แบบ read-only ของ attribute ของ account คล้าย ๆ กับ [evaluation context](https://openfeature.dev/specification/sections/evaluation-context/) ของ OpenFeature ที่เป็นข้อมูลให้ flag evaluation เอาไปใช้ทำ targeting ได้ ใน interpreter อื่น ตัว context ยังถือตัวแปรที่ expression กำหนดค่าให้, เวลาปัจจุบัน, ตัวนับที่บังคับเพดานต้นทุน หรือบันทึกว่า node ไหนเป็นตัวตัดสินผลลัพธ์ เพื่อให้อธิบายการตัดสินได้

**การ parse เป็นอีกเรื่องหนึ่ง** pattern นี้อธิบายวิธีแทนและ evaluate ประโยค ไม่ได้อธิบายวิธีแปลงข้อความเป็น tree และหนังสือก็ข้ามเรื่อง parse ไป วิธีสร้าง tree ที่ใช้กันปกติมีสามแบบ:

- ในโค้ด ผ่าน constructor หรือ builder API เล็ก ๆ ถ้านักพัฒนาเป็นคนเขียนกฎเอง (internal DSL)
- ด้วย recursive-descent parser ที่เขียนเอง: หนึ่ง function ต่อหนึ่งกฎของ grammar แต่ละตัวเรียก function ของกฎที่มันมีอยู่ข้างใน สำหรับ grammar แบบนี้ก็แค่ไม่กี่สิบบรรทัด อย่างที่โค้ดข้างล่างแสดง และ *Crafting Interpreters* ก็สร้างมันทีละขั้นใน [Parsing Expressions](https://craftinginterpreters.com/parsing-expressions.html)
- ด้วย parser generator อย่าง [ANTLR](https://www.antlr.org/) ที่สร้าง parser จาก grammar ให้ และจะคุ้มเมื่อ grammar โตขึ้น

บางระบบข้ามข้อความไปเลย แล้วเก็บตัว tree เอง: กฎ [JsonLogic](https://jsonlogic.com/) คือ JSON tree ของ operator ที่ evaluate ได้ตรง ๆ และ flagd ก็เขียนกฎ targeting ของมันด้วย JsonLogic ที่ดัดแปลงแล้ว ไม่ว่าจะแบบไหน ให้ parse ครั้งเดียวตอนบันทึกกฎแล้วเก็บ tree ไว้ syntax error จะได้ไปถึงคนที่แก้กฎ แทนที่จะทำให้ request fail และการเช็กแต่ละครั้งก็จ่ายแค่ค่าเดิน tree

## โค้ด

TypeScript ที่ตรงกับ diagram ตัว Node 22.18 ขึ้นไปรันได้เลยตามนี้ (`node targeting.ts`): มันตัด type ทิ้งและไม่ได้เช็ก เลยต้องรัน `tsc --noEmit` เพื่อเช็ก type

```ts
import assert from 'node:assert/strict';

type Context = Record<string, string | number>;     // Context: the account's attributes
interface Expr { interpret(ctx: Context): boolean; } // AbstractExpression: any node of the tree

// TerminalExpressions: compare one attribute of the context with a literal.
class Equals implements Expr {
  readonly name: string; readonly value: string | number;
  constructor(name: string, value: string | number) { this.name = name; this.value = value; }
  interpret(ctx: Context) { return ctx[this.name] === this.value; }
}
class GreaterThan implements Expr {
  readonly name: string; readonly limit: number;
  constructor(name: string, limit: number) { this.name = name; this.limit = limit; }
  interpret(ctx: Context) { const v = ctx[this.name]; return typeof v === 'number' && v > this.limit; }
}
// NonterminalExpressions: ask their children, left first, and combine the answers.
abstract class Binary implements Expr {
  readonly left: Expr; readonly right: Expr;
  constructor(left: Expr, right: Expr) { this.left = left; this.right = right; }
  abstract interpret(ctx: Context): boolean;
}
class And extends Binary {
  interpret(ctx: Context) { return this.left.interpret(ctx) && this.right.interpret(ctx); }
}
class Or extends Binary {
  interpret(ctx: Context) { return this.left.interpret(ctx) || this.right.interpret(ctx); }
}

// Parsing is a separate step: recursive descent, one function per grammar rule.
function parse(text: string): Expr {
  const tokens = [...text.matchAll(/'[^']*'|\d+|\w+|\S/g)]; // strings, numbers, words, symbols
  let pos = 0;
  const peek = () => tokens[pos]?.[0];
  const fail = (msg: string, at = pos): never => {
    throw new SyntaxError(`${msg} at column ${(tokens[at]?.index ?? text.length) + 1}`);
  };
  const next = (want?: string): string => {
    const t = peek();
    if (t === undefined || (want && t !== want)) return fail(`expected ${want ?? 'more'}`);
    pos++; return t;
  };
  const expr = (): Expr => { // expr := term ('or' term)*
    let e = term(); while (peek() === 'or') { next(); e = new Or(e, term()); } return e;
  };
  const term = (): Expr => { // term := factor ('and' factor)*
    let e = factor(); while (peek() === 'and') { next(); e = new And(e, factor()); } return e;
  };
  const factor = (): Expr => { // factor := comparison | '(' expr ')'
    if (peek() === '(') { next(); const e = expr(); next(')'); return e; }
    const name = next(), op = next(), lit = next();
    const value = /^'.*'$/.test(lit) ? lit.slice(1, -1) : /^\d+$/.test(lit) ? Number(lit) : null;
    if (op === '=' && value !== null) return new Equals(name, value);
    if (op === '>' && typeof value === 'number') return new GreaterThan(name, value);
    return fail(`can't read ${name} ${op} ${lit}`, pos - 3);
  };
  const tree = expr();
  if (pos < tokens.length) fail(`unexpected ${peek()}`);
  return tree;
}

// Client: parse once when the rule is saved, then interpret the tree for every check.
const rule = parse("country = 'TH' and (plan = 'pro' or seats > 10)");
assert.deepEqual(rule, new And(new Equals('country', 'TH'),
  new Or(new Equals('plan', 'pro'), new GreaterThan('seats', 10))));
const accounts = [
  { country: 'TH', plan: 'free', seats: 12 },
  { country: 'TH', plan: 'free', seats: 5 },
  { country: 'JP', plan: 'pro', seats: 50 }, // And stops at the first false: Or never runs
];
assert.deepEqual(accounts.map((ctx) => rule.interpret(ctx)), [true, false, false]);
assert.throws(() => parse("country = 'TH' and (plan = 'pro'"), /expected \) at column 33/);
for (const ctx of accounts) console.log(JSON.stringify(ctx), '->', rule.interpret(ctx));
// {"country":"TH","plan":"free","seats":12} -> true
// {"country":"TH","plan":"free","seats":5} -> false
// {"country":"JP","plan":"pro","seats":50} -> false
```

`expr()`, `term()` และ `factor()` คือกฎสามข้อของ grammar และลำดับที่พวกมันเรียกกันก็คือสิ่งที่ทำให้ `and` ผูกแน่นกว่า `or` เพราะแต่ละ function จะ return ก็ต่อเมื่อสร้าง operand ของมันเสร็จแล้ว leaf เลยถูกสร้างก่อน node ที่ถือมัน ตรงกับลำดับที่ diagram แสดง ตัว parser จะปฏิเสธสิ่งที่มันอ่านไม่ออกแทนการเดา: `plan = pro` ที่ไม่มี quote และ `seats > ten` จะ fail ทั้งคู่พร้อมเลข column ส่วน parser ที่หละหลวมกว่าจะสร้าง `Equals` ที่ไม่มีวัน match ขึ้นมาเงียบ ๆ

## ใช้ตอนไหนดี

- กฎที่เปลี่ยนบ่อยกว่าโค้ดที่รันมัน หรือต่างกันไปตามลูกค้า, tenant หรือ region: targeting และ segmentation, เงื่อนไขราคาและส่วนลด, กฎ alerting และ routing, กฎ validation, search filter, access policy
- กฎที่คนอื่นนอกจากนักพัฒนาของ service อ่านหรือแก้ หรือต้องเก็บ, ทำ version และ audit ในรูปข้อมูล
- grammar ที่เล็กและนิ่งเร็ว และความเร็วในการ evaluate ไม่ได้สำคัญมาก: การเดิน tree ไม่กี่ node ต่อ request นั้นไม่แพง
- ไม่ใช้กับภาษาใหญ่ ภาษา general-purpose หรือ SQL เต็มรูปแบบต้องมี parser ตัวจริงที่ปกติก็ generate ขึ้นมา และมีตัว evaluate ที่ compile tree ให้เป็นอะไรที่รันเร็วกว่า (ดู *ข้อควรรู้ตอนลงมือทำ*)
- ไม่ใช้ถ้ามี expression language ที่ใช้กันอยู่แล้วและเข้ากันได้ CEL, Rego หรือ JsonLogic มาพร้อม documentation, เครื่องมือ, test และคุณสมบัติด้านความปลอดภัย ที่ภาษาทำเองต้องสร้างขึ้นมาเอง
- ไม่ใช้ถ้าแค่ตัวเลือกตายตัวไม่กี่แบบก็พอ: ถ้ากฎทุกข้อเป็นแค่ list ของประเทศกับจำนวน seat ขั้นต่ำ configuration schema ก็ง่ายกว่าภาษา

## ได้อะไร เสียอะไร

- **ขยายภาษาได้ง่าย** operator ใหม่คือ class เพิ่มหนึ่งตัวบวกการแก้ parser และ class ที่มีอยู่ก็ไม่ต้องเปลี่ยน
- **โค้ดตามอ่านง่าย** class แต่ละตัวตรงกับโครงสร้างหนึ่งแบบ และ `interpret()` ของมันก็ยาวแค่บรรทัดสองบรรทัด
- **operation ใหม่แพง** การ evaluate เป็น method ในทุก node class และ operation อื่น ๆ ที่เพิ่มเข้ามาก็เหมือนกัน: พิมพ์กฎกลับเป็นข้อความ, อธิบายการตัดสิน, list attribute ที่กฎอ่าน, เช็ก type หรือแปลงกฎเป็น SQL query ส่วน Visitor ย้าย operation พวกนี้ออกจาก node class ได้ (ดู *ข้อควรรู้ตอนลงมือทำ*)
- **การเดิน tree ช้า** node แต่ละตัวเสีย virtual call หนึ่งครั้ง และ node ก็เป็น object แยกกันกระจายอยู่ทั่ว heap สำหรับกฎ targeting แบบนี้ไม่เป็นไร แต่ช้าเกินไปสำหรับภาษา general-purpose
- **grammar ใหญ่ดูแลยาก** หนึ่ง class ต่อหนึ่งโครงสร้างจะโตเป็น hierarchy ใหญ่ และหนังสือเองก็ชี้ไปที่ parser generator และเครื่องมือคล้าย ๆ กันเมื่อ grammar เริ่มซับซ้อน
- **ภาษาคือ product** ผู้ใช้ของมันต้องมี documentation, error message ที่ชัด และความหมายที่นิ่ง และกฎที่บันทึกไว้ภายใต้ grammar เวอร์ชันหนึ่งต้องยังใช้ได้หลังการเปลี่ยนครั้งถัดไป

## ข้อควรรู้ตอนลงมือทำ

- **การรายงาน error** error สองแบบต้องจัดการต่างกัน
  - *Syntax error* เกิดตอนบันทึกกฎ ให้รายงานว่าปัญหาอยู่ตรงไหนและคาดว่าจะเจออะไร (parser ข้างบนบอกว่า `expected ) at column 33`) แล้วไม่ยอมเก็บกฎนั้น
  - *ปัญหาตอน evaluate* เกิดระหว่างการเช็ก: attribute ที่ context ไม่มี หรือค่าที่ type ผิด อย่าง `seats > 'ten'` ให้ตัดสินว่ามันหมายถึงอะไร: false หรือ error แล้วทำให้ node ทุกตัวเห็นตรงกัน ดีกว่านั้นคือตอนบันทึกให้เช็กกฎแต่ละข้อกับ schema ของ attribute ที่รู้จักและ type ของมัน ตัว Kubernetes ทำแบบนี้กับ CEL: validation rule ของ custom resource definition ถูกเช็ก type เต็มรูปแบบ และ expression ที่อ้างถึง field ที่ไม่ได้นิยามไว้ของตัวแปรที่มี type จะไม่ผ่านการเช็ก
- **Performance: เดิน tree, closure หรือ bytecode** การเดิน tree เป็นตัว evaluate ที่ง่ายที่สุด และพอสำหรับกฎเล็ก ๆ ตัวอย่างในหนังสือเองก็ชี้ว่ามันแทบไม่เคยเร็วที่สุด: ปกติ regular expression จะถูก match ด้วย state machine ที่สร้างจากมัน ไม่ได้ match ด้วยการเดิน tree ของมัน วิธีแปลง tree ก่อนรันที่ใช้กันบ่อยมีสองแบบ:
  - *Closure* เดิน tree ครั้งเดียว แล้วเปลี่ยน node แต่ละตัวเป็น function ที่เรียก function ของลูก ๆ อย่าง `(ctx) => left(ctx) && right(ctx)` สำหรับ `And` การเช็กแต่ละครั้งก็จะรันแค่การเรียก function ธรรมดา และงานอย่างการหาชื่อ attribute ก็ทำครั้งเดียวตอน compile ได้
  - *Bytecode* แผ่ tree ให้เป็น array ของคำสั่งง่าย ๆ แล้วรันมันใน loop ตัว [PostgreSQL](https://github.com/postgres/postgres/blob/master/src/backend/executor/README) evaluate expression อย่าง clause `WHERE` จาก array ของ step แบบแบน ๆ แทนการเดิน expression tree เพราะงานต่อ node นั้นเล็กเมื่อเทียบกับต้นทุนของการเดิน และ step ชุดเดียวกันก็ [JIT-compile](https://www.postgresql.org/docs/current/jit-reason.html) เป็น native code ได้ ส่วน [SQLite](https://www.sqlite.org/opcode.html) compile SQL statement ทุกตัวเป็น bytecode สำหรับ virtual machine ของมันเอง และ SpEL ที่เป็น expression language ของ Spring ตีความ expression โดย default และตั้งค่าให้ [compile](https://docs.spring.io/spring-framework/reference/core/expressions/evaluation.html) expression เป็น Java class ที่ generate ขึ้นได้ หลังจากมันรันในโหมดตีความไปแล้ว

  *Crafting Interpreters* สร้างทั้งสองแบบ: tree-walking interpreter ใน Java แล้วต่อด้วย bytecode virtual machine ใน C บท [Chunks of Bytecode](https://craftinginterpreters.com/chunks-of-bytecode.html) อธิบายว่าทำไมการเดิน tree ถึงช้า ลงไปถึง pointer ระหว่าง object บน heap ที่ทำให้ CPU cache ใช้ไม่ได้ผล
- **short-circuit และลำดับ** `And` กับ `Or` evaluate operand ทางซ้ายก่อน และหยุดทันทีที่รู้ผลลัพธ์ ทำให้ account ในญี่ปุ่นไม่เคยไปถึง branch ของ `Or` ให้วางเงื่อนไขที่ไม่แพงหรือที่คัดออกได้เยอะไว้ก่อน และอย่าให้ expression มี side effect เพื่อให้ลำดับเปลี่ยนแค่ความเร็ว ไม่เคยเปลี่ยนผลลัพธ์
- **ความปลอดภัยเมื่อผู้ใช้เขียนกฎเอง**
  - อย่าแปลงกฎเป็นโค้ดของภาษา host แล้วรันด้วย `eval()` หรือ `new Function()` เด็ดขาด กฎจะรันด้วยสิทธิ์ทุกอย่างของ service นี่คือเหตุผลที่หน้า [`eval()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval) ของ MDN เตือนไม่ให้ใช้มัน ส่วน interpreter ทำได้แค่สิ่งที่ class ของมันทำ: กฎเทียบ attribute ได้ แต่อ่านไฟล์หรือเรียก network service ไม่ได้ JsonLogic ใช้ข้อนี้เป็นจุดขาย: กฎไม่เคยผ่าน `eval()` และอ่านได้แค่ข้อมูลที่ส่งให้มัน
  - จำกัดว่ากฎหนึ่งข้อจะกินทรัพยากรได้แค่ไหน ทั้ง recursive-descent parser และ `interpret()` แบบ recursive ใช้ stack frame หนึ่งตัวต่อการซ้อนหนึ่งชั้น เลยต้องจำกัดความลึกของการซ้อน ความยาวของข้อความ และจำนวน node ส่วนอะไรก็ตามที่ไม่ linear ต้องมีขอบเขตของตัวเอง: loop บน list และตัว regular expression ที่ควรส่งไปให้ engine ที่ match ได้ใน linear time อย่าง RE2 ตัว engine ที่ `matches()` ของ CEL ใช้ syntax ของมัน
  - CEL ถูกออกแบบมาสำหรับ expression ที่ไว้ใจไม่ได้: project บอกว่ามันไม่ Turing-complete ไม่มี mutation และใช้เวลา evaluate แบบ linear และมันอ่านแค่ข้อมูลที่ application ที่เป็น host ส่งให้ ส่วน Kubernetes เพิ่ม [runtime cost budget](https://kubernetes.io/docs/reference/using-api/cel/) ที่หยุด expression ที่รันนานเกินไป และสำหรับบาง resource ก็ปฏิเสธ expression ตั้งแต่ตอนเขียน ถ้าประมาณกรณีแย่ที่สุดแล้วแพงเกินไป
- **แชร์ node** node เป็น immutable ทำให้ subtree ที่เหมือนกันแชร์กันได้: object `Equals('country', 'TH')` ตัวเดียวใช้กับทุกกฎที่มีการเปรียบเทียบนั้นได้ หนังสือแนะนำ [Flyweight](../flyweight/) สำหรับแชร์ terminal symbol แบบนี้
- **เดิน tree โดยไม่ evaluate** บางคำถามต้องดูทุก node แต่ไม่ต้อง evaluate อย่างเช่นกฎนี้อ่าน attribute อะไรบ้าง service จะได้รู้ว่าต้องใส่อะไรลงใน context หรือเตือนเรื่องกฎที่อ้างถึง attribute ที่ไม่มีอยู่ ตัว [Iterator](../iterator/) บน tree ก็ตอบคำถามพวกนี้ได้ และใน TypeScript แค่ generator แบบ recursive ที่วนลูก ๆ ก็พอ
- **Interpreter, Composite และ Visitor**
  - syntax tree คือ [Composite](../composite/): `And` กับ `Or` ถือลูกของมันผ่าน interface เดียวกับที่ leaf implement ตัว Composite พูดถึงรูปร่าง ส่วนย่อยกับส่วนรวมที่จัดการแบบเดียวกัน ส่วน Interpreter ให้ความหมายกับรูปร่างนั้น เป็นภาษาที่ประโยคของมันถูก evaluate
  - ใน Interpreter การ evaluate เป็น method บน node class แต่ละตัว ส่วน [Visitor](../visitor/) ย้าย operation ไปไว้ใน class แยก หนึ่ง class ต่อหนึ่ง operation และมี method หนึ่งตัวต่อ node หนึ่งแบบ ทำให้ operation ใหม่ (พิมพ์ อธิบาย แปลงเป็น SQL) เป็นแค่ class ใหม่หนึ่งตัว แต่ node แบบใหม่จะกลายเป็นการแก้ visitor ทุกตัว [*Crafting Interpreters*](https://craftinginterpreters.com/representing-code.html) ชั่งทางเลือกนี้ตรง ๆ แล้วไม่เลือก Interpreter pattern: tree class ของมันรับใช้หลายขั้น ตั้งแต่ parser ไปถึง interpreter และการมี method หนึ่งตัวต่อหนึ่งขั้นในทุก class จะทำให้ทุกอย่างพันกัน มันเลยใช้ Visitor แทน
  - ในภาษาที่ function เป็นค่า node ก็เป็นแค่ closure ได้เลย ถ้าใช้ discriminated union กับ `switch` หนึ่งตัวต่อหนึ่ง operation ตัว tree ก็ได้ข้อแลกเปลี่ยนแบบเดียวกับ Visitor: operation ใหม่คือ function หนึ่งตัว และ node แบบใหม่คือการแก้ทุก function
- **ที่ระดับ architecture** การเก็บกฎเป็นข้อมูลและมี interpreter อยู่ในทุก service คือวิธีที่ [Feature Flags](../feature-flags/) และ [Policy-Based Authorization](../policy-based-authorization/) ทำงาน flag service เก็บกฎ targeting แล้วส่งไปให้ SDK ที่ evaluate มันใน process กับ evaluation context ยกตัวอย่าง [flagd](https://flagd.dev/reference/flag-definitions/) ก็เขียนกฎพวกนี้ด้วย JsonLogic ที่ดัดแปลงแล้ว ส่วน policy engine evaluate policy กับ attribute ของ request อย่างที่ Open Policy Agent ทำกับ Rego และมันยัง compile Rego เป็น [WebAssembly](https://www.openpolicyagent.org/docs/wasm) ได้ด้วย ที่ระดับนั้นมีสามอย่างที่เปลี่ยนไป:
  - กฎกลายเป็น artifact ที่ deploy ได้: มี version, ผ่าน test, rollout และ rollback ได้ และทุกการตัดสินควรบันทึก version ของกฎที่ใช้ตัดสิน
  - implementation หลายตัวต้องเห็นตรงกัน SDK ในแต่ละภาษามี interpreter ของภาษาเดียวกันเป็นของตัวเอง ภาษาเลยต้องมี specification ที่แม่นยำและ test ที่ใช้ร่วมกัน อย่าง CEL ก็เผยแพร่ [conformance test](https://github.com/cel-expr/cel-spec/tree/master/tests) ที่ implementation ของมันต้องผ่าน
  - การ evaluate ย้ายไปอยู่ข้าง caller เพื่อให้อยู่ใน latency budget ของมัน เป็นอีกเหตุผลที่ต้องให้ภาษาเล็กและต้นทุนมีขอบเขต
- **เจอได้ที่ไหนบ้าง**
  - regular expression ที่เป็นตัวอย่างในหนังสือเอง ตัว `java.util.regex.Pattern` ของ Java compile pattern เป็น graph ของ [object `Node`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/regex/Pattern.java) ที่แต่ละตัวมี method `match()` ของตัวเอง เกือบจะเป็น Interpreter เป๊ะ ๆ ส่วน `re` ของ Python compile pattern เป็น [list ของ opcode](https://github.com/python/cpython/blob/main/Lib/re/_compiler.py) ให้ matching engine ของมัน ที่เขียนด้วย C
  - SpEL ของ Spring ที่ syntax tree มี class อย่าง [`OpAnd`](https://github.com/spring-projects/spring-framework/blob/main/spring-expression/src/main/java/org/springframework/expression/spel/ast/OpAnd.java), `OpOr`, `OpEQ` และ `OpGT` ที่แต่ละตัว evaluate ตัวเองกับ `ExpressionState` ที่เป็น context ของมัน ส่วน `OpAnd` คืน false โดยไม่ evaluate operand ทางขวาเลยถ้าทางซ้ายเป็น false
  - CEL ([cel.dev](https://cel.dev/)) ใน validation rule และ admission policy ของ [Kubernetes](https://kubernetes.io/docs/reference/using-api/cel/) และใน [Envoy](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/advanced/attributes) ที่เปิด attribute ของ request ให้ CEL expression ใน RBAC filter ของมันใช้
  - Rego ที่เป็น [policy language](https://www.openpolicyagent.org/docs/policy-language) ของ Open Policy Agent และได้แรงบันดาลใจจาก Datalog
  - clause `WHERE` ของ SQL ที่ database อย่าง PostgreSQL และ SQLite evaluate ด้วย interpreter ของตัวเอง อย่างที่อธิบายไว้ข้างบน
- **อ่านเพิ่มเติม** [*Crafting Interpreters*](https://craftinginterpreters.com/) ของ Robert Nystrom ที่อ่านออนไลน์ได้ฟรี สร้าง scripting language สองรอบ รอบแรกเป็น tree-walking interpreter แล้วต่อด้วย bytecode virtual machine ส่วน [*Domain-Specific Languages*](https://martinfowler.com/books/dsl.html) ของ Martin Fowler กับ Rebecca Parsons อธิบายวิธีสร้างทั้ง internal DSL และ external DSL และวิธีเลือกระหว่างสองแบบนี้
