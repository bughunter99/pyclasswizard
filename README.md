# pyclasswizard

**pyclasswizard** is a Python library and CLI tool that generates Python class
boilerplate from a simple specification.  Stop writing repetitive `__init__`,
`__repr__`, and `__eq__` methods by hand.

---

## Installation

```bash
pip install pyclasswizard
```

---

## Quick start

### CLI

```
usage: pyclasswizard [-h] [--mode {regular,dataclass,namedtuple}]
                     [--base BASE] [--docstring TEXT]
                     [--no-repr] [--no-eq] [--str] [--output FILE]
                     class_name [FIELD ...]
```

**Field format**

| Syntax | Meaning |
|--------|---------|
| `name` | field with type `Any` |
| `name:type` | field with explicit type hint |
| `name:type=default` | field with type hint and default value |

**Examples**

Generate a regular class with two fields:

```bash
pyclasswizard Person name:str age:int=0
```

Output:

```python
class Person:
    def __init__(self, name: str, age: int = 0) -> None:
        self.name = name
        self.age = age

    def __repr__(self) -> str:
        return f"Person(name={self.name!r}, age={self.age!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, self.__class__):
            return NotImplemented
        return self.name == other.name and self.age == other.age
```

Generate a `@dataclass`:

```bash
pyclasswizard Config debug:bool=False retries:int=3 --mode dataclass
```

Generate a `NamedTuple`:

```bash
pyclasswizard Color r:int g:int b:int --mode namedtuple
```

Write the output directly to a file:

```bash
pyclasswizard Person name:str age:int -o person.py
```

---

### Python API

```python
from pyclasswizard import ClassWizard, ClassMode, FieldSpec

fields = [
    FieldSpec("name", "str"),
    FieldSpec("age", "int", default="0"),
]

wizard = ClassWizard(
    "Person",
    fields,
    mode=ClassMode.REGULAR,
    class_docstring="Represents a person.",
    generate_str=True,
)

print(wizard.generate())
```

---

## Modes

| Mode | Description |
|------|-------------|
| `regular` | Plain class with `__init__`, optional `__repr__` / `__eq__` / `__str__` |
| `dataclass` | `@dataclass`-decorated class |
| `namedtuple` | Immutable `NamedTuple` subclass |

---

## Running the tests

```bash
pip install pytest
pytest
```
