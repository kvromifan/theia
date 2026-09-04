# THEIA — A language made by people, for people.

Python? JavaScript? Ruby? Which one is the best?!??!?!?

Actually, you know what, let's just build one language that everyone can agree on.

Don't like it? It's literally built by you.

## Usage

Run a script by passing it to the interpreter:

```bash
node run.js <file.thi>
```

## Core Features & Syntax

### Built-in Functions

* **`out(val)`**: Prints the value to stdout preceded by an ISO timestamp.


* **`prompt(msg)`**: Pauses execution to ask for user input.


* **`str(val)`**: Converts a value to a string.


* **`num(val)`**: Parses a value into a floating-point number (defaults to 0 if invalid).


* **`len(val)`**: Returns the string length of the passed value.



### Control Flow & Variables

Variables are declared by assignment without keywords.

```text
# Comments use a hash
import my_module

x = 10
if x == 10
  out("Ten")
elif x > 10
  out("Bigger")
else
  out("Smaller")
end

while x < 20
  x = x + 1
  if x == 15
    break
  end
end

```

### Custom Functions

Define internal functions using `fn` and `end`:

```text
fn greet(name)
  out("Hello, " + name)
  return 1
end

greet("User")

```

---

## How to Contribute: Making a Module

You can extend THEIA by writing modules in its parent language, JavaScript.

**IMPORTANT:** ALWAYS update `package.json` with the new version whenever making ANY change to the programming language, whether it's a new module, fixing a tiny bug, modifying the main interpreter, and so on.

### Module Rules

1. Put the script in the `/modules/` directory.

2. The filename must follow the format `modulename.js`. It can **only** contain characters `a-z` and `_`. No numbers or other characters allowed.

3. You must create a corresponding `modulename.md` file in the `/modules/` folder documenting its usage.

4. In `.thi` files, modules must be imported at the very top of a `.thi` file before any statements.


### Example: `/modules/math_ops.js`

```javascript
module.exports = {
  // Optional initialization hook executed when imported
  init: async (ctx) => {
    // Modify ctx or setup connections here
  },
  fns: {
    // Functions are merged into ctx.fns and become globally available
    // Arguments are always passed as an array
    square: async ([arg]) => {
      return arg * arg;
    },
    power: async ([base, exp]) => {
      return Math.pow(base, exp);
    }
  }
};

```

### Example: `/modules/math_ops.md`

```markdown
# math_ops module

Provides advanced math functions for THEIA.

## Functions
* `square(x)`: Returns the square of `x`.
* `power(base, exp)`: Returns `base` raised to the power of `exp`.

```

### Using Your Module

```text
import math_ops

result = square(4)
out(result)

```
