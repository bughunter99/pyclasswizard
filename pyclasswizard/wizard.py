"""Core class generation logic for pyclasswizard."""

from __future__ import annotations

import textwrap
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class ClassMode(str, Enum):
    """Supported class generation modes."""

    REGULAR = "regular"
    DATACLASS = "dataclass"
    NAMEDTUPLE = "namedtuple"


@dataclass
class FieldSpec:
    """Specification for a single class field."""

    name: str
    type_hint: str = "Any"
    default: Optional[str] = None
    docstring: Optional[str] = None

    @classmethod
    def from_string(cls, spec: str) -> "FieldSpec":
        """Parse a field spec string in the form ``name``, ``name:type``, or
        ``name:type=default``."""
        default = None
        if "=" in spec:
            spec, default = spec.split("=", 1)
            default = default.strip()
        if ":" in spec:
            name, type_hint = spec.split(":", 1)
            return cls(name=name.strip(), type_hint=type_hint.strip(), default=default)
        return cls(name=spec.strip(), default=default)


class ClassWizard:
    """Generate Python class source code from a specification.

    Parameters
    ----------
    class_name:
        The name of the class to generate.
    fields:
        An ordered list of :class:`FieldSpec` objects describing the class
        attributes.
    mode:
        The style of class to generate.  One of ``"regular"``,
        ``"dataclass"``, or ``"namedtuple"``.
    base_classes:
        Optional list of base-class names to include in the class header.
    class_docstring:
        Optional docstring to include in the generated class.
    generate_repr:
        When *mode* is ``"regular"``, whether to emit a ``__repr__`` method.
    generate_eq:
        When *mode* is ``"regular"``, whether to emit an ``__eq__`` method.
    generate_str:
        When *mode* is ``"regular"``, whether to emit a ``__str__`` method.
    """

    def __init__(
        self,
        class_name: str,
        fields: Optional[List[FieldSpec]] = None,
        *,
        mode: ClassMode = ClassMode.REGULAR,
        base_classes: Optional[List[str]] = None,
        class_docstring: Optional[str] = None,
        generate_repr: bool = True,
        generate_eq: bool = True,
        generate_str: bool = False,
    ) -> None:
        if not class_name.isidentifier():
            raise ValueError(f"Invalid class name: {class_name!r}")
        self.class_name = class_name
        self.fields: List[FieldSpec] = fields or []
        self.mode = ClassMode(mode)
        self.base_classes: List[str] = base_classes or []
        self.class_docstring = class_docstring
        self.generate_repr = generate_repr
        self.generate_eq = generate_eq
        self.generate_str = generate_str

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate(self) -> str:
        """Return the generated source code as a string."""
        if self.mode == ClassMode.DATACLASS:
            return self._generate_dataclass()
        if self.mode == ClassMode.NAMEDTUPLE:
            return self._generate_namedtuple()
        return self._generate_regular()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _imports(self) -> List[str]:
        """Return the import lines required for the chosen mode."""
        lines: List[str] = []
        if self.mode == ClassMode.DATACLASS:
            lines.append("from dataclasses import dataclass, field")
        elif self.mode == ClassMode.NAMEDTUPLE:
            lines.append("from typing import NamedTuple")
        needs_any = any(f.type_hint == "Any" for f in self.fields)
        if needs_any:
            lines.append("from typing import Any")
        return lines

    @staticmethod
    def _indent(text: str, spaces: int = 4) -> str:
        return textwrap.indent(text, " " * spaces)

    def _class_header(self, extra_bases: Optional[List[str]] = None) -> str:
        bases = list(self.base_classes)
        if extra_bases:
            bases = extra_bases + bases
        if bases:
            return f"class {self.class_name}({', '.join(bases)}):"
        return f"class {self.class_name}:"

    def _docstring_block(self, text: str) -> str:
        lines = text.strip().splitlines()
        if len(lines) == 1:
            return f'"""{lines[0]}"""'
        inner = "\n".join(lines)
        return f'"""\n{inner}\n"""'

    # ------------------------------------------------------------------
    # Regular class
    # ------------------------------------------------------------------

    def _generate_regular(self) -> str:
        parts: List[str] = []
        imports = self._imports()
        if imports:
            parts.append("\n".join(imports))
            parts.append("")

        parts.append(self._class_header())

        body: List[str] = []

        if self.class_docstring:
            body.append(self._docstring_block(self.class_docstring))
            body.append("")

        # __init__
        body.append(self._regular_init())

        if self.generate_repr:
            body.append("")
            body.append(self._regular_repr())

        if self.generate_eq:
            body.append("")
            body.append(self._regular_eq())

        if self.generate_str:
            body.append("")
            body.append(self._regular_str())

        if not body:
            body.append("pass")

        parts.append(self._indent("\n".join(body)))
        return "\n".join(parts) + "\n"

    def _regular_init(self) -> str:
        if not self.fields:
            return "def __init__(self) -> None:\n    pass"

        params: List[str] = []
        for f in self.fields:
            hint = f": {f.type_hint}" if f.type_hint else ""
            if f.default is not None:
                params.append(f"{f.name}{hint} = {f.default}")
            else:
                params.append(f"{f.name}{hint}")

        # Decide whether params fit on one line (<=88 chars) or need wrapping
        sig_one_line = f"def __init__(self, {', '.join(params)}) -> None:"
        if len(sig_one_line) <= 88:
            lines = [sig_one_line]
        else:
            lines = ["def __init__("]
            lines.append("    self,")
            for p in params:
                lines.append(f"    {p},")
            lines.append(") -> None:")

        assignments = [f"    self.{f.name} = {f.name}" for f in self.fields]
        return "\n".join(lines + assignments)

    def _regular_repr(self) -> str:
        if not self.fields:
            return (
                "def __repr__(self) -> str:\n"
                f"    return f\"{self.class_name}()\""
            )
        parts = ", ".join(f"{f.name}={{self.{f.name}!r}}" for f in self.fields)
        return (
            "def __repr__(self) -> str:\n"
            f'    return f"{self.class_name}({parts})"'
        )

    def _regular_eq(self) -> str:
        if not self.fields:
            return (
                "def __eq__(self, other: object) -> bool:\n"
                "    if not isinstance(other, self.__class__):\n"
                "        return NotImplemented\n"
                "    return True"
            )
        comparisons = " and ".join(
            f"self.{f.name} == other.{f.name}" for f in self.fields
        )
        return (
            "def __eq__(self, other: object) -> bool:\n"
            "    if not isinstance(other, self.__class__):\n"
            "        return NotImplemented\n"
            f"    return {comparisons}"
        )

    def _regular_str(self) -> str:
        if not self.fields:
            return f"def __str__(self) -> str:\n    return self.__class__.__name__"
        attrs = ", ".join(f"{f.name}={{self.{f.name}}}" for f in self.fields)
        return f"def __str__(self) -> str:\n    return f\"{self.class_name}({attrs})\""

    # ------------------------------------------------------------------
    # Dataclass
    # ------------------------------------------------------------------

    def _generate_dataclass(self) -> str:
        parts: List[str] = []
        imports = self._imports()
        if imports:
            parts.append("\n".join(imports))
            parts.append("")

        parts.append("@dataclass")
        parts.append(self._class_header())

        body: List[str] = []

        if self.class_docstring:
            body.append(self._docstring_block(self.class_docstring))
            body.append("")

        for f in self.fields:
            hint = f": {f.type_hint}"
            if f.default is not None:
                body.append(f"{f.name}{hint} = {f.default}")
            else:
                body.append(f"{f.name}{hint}")

        if not body:
            body.append("pass")

        parts.append(self._indent("\n".join(body)))
        return "\n".join(parts) + "\n"

    # ------------------------------------------------------------------
    # NamedTuple
    # ------------------------------------------------------------------

    def _generate_namedtuple(self) -> str:
        parts: List[str] = []
        imports = self._imports()
        if imports:
            parts.append("\n".join(imports))
            parts.append("")

        parts.append(self._class_header(extra_bases=["NamedTuple"]))

        body: List[str] = []

        if self.class_docstring:
            body.append(self._docstring_block(self.class_docstring))
            body.append("")

        for f in self.fields:
            hint = f": {f.type_hint}"
            if f.default is not None:
                body.append(f"{f.name}{hint} = {f.default}")
            else:
                body.append(f"{f.name}{hint}")

        if not body:
            body.append("pass")

        parts.append(self._indent("\n".join(body)))
        return "\n".join(parts) + "\n"
