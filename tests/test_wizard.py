"""Tests for pyclasswizard.wizard and pyclasswizard.cli."""

import textwrap

import pytest

from pyclasswizard import ClassMode, ClassWizard, FieldSpec
from pyclasswizard.cli import main


# ---------------------------------------------------------------------------
# FieldSpec
# ---------------------------------------------------------------------------


class TestFieldSpec:
    def test_name_only(self):
        f = FieldSpec.from_string("age")
        assert f.name == "age"
        assert f.type_hint == "Any"
        assert f.default is None

    def test_name_and_type(self):
        f = FieldSpec.from_string("age:int")
        assert f.name == "age"
        assert f.type_hint == "int"
        assert f.default is None

    def test_name_type_default(self):
        f = FieldSpec.from_string("age:int=0")
        assert f.name == "age"
        assert f.type_hint == "int"
        assert f.default == "0"

    def test_default_with_spaces(self):
        f = FieldSpec.from_string("label:str= 'hello' ")
        assert f.default == "'hello'"

    def test_type_with_brackets(self):
        f = FieldSpec.from_string("items:list[str]")
        assert f.type_hint == "list[str]"


# ---------------------------------------------------------------------------
# ClassWizard – regular mode
# ---------------------------------------------------------------------------


class TestClassWizardRegular:
    def test_empty_class(self):
        src = ClassWizard("Empty").generate()
        assert "class Empty:" in src
        assert "def __init__(self) -> None:" in src
        assert "pass" in src

    def test_invalid_class_name(self):
        with pytest.raises(ValueError, match="Invalid class name"):
            ClassWizard("123Bad")

    def test_fields_in_init(self):
        fields = [FieldSpec("x", "int"), FieldSpec("y", "int")]
        src = ClassWizard("Point", fields).generate()
        assert "self.x = x" in src
        assert "self.y = y" in src

    def test_repr_generated_by_default(self):
        fields = [FieldSpec("name", "str")]
        src = ClassWizard("Foo", fields).generate()
        assert "def __repr__(self) -> str:" in src
        assert "Foo(name={self.name!r})" in src

    def test_repr_suppressed(self):
        src = ClassWizard("Foo", generate_repr=False).generate()
        assert "__repr__" not in src

    def test_eq_generated_by_default(self):
        fields = [FieldSpec("x", "int")]
        src = ClassWizard("Bar", fields).generate()
        assert "def __eq__(self, other: object) -> bool:" in src
        assert "self.x == other.x" in src

    def test_eq_suppressed(self):
        src = ClassWizard("Bar", generate_eq=False).generate()
        assert "__eq__" not in src

    def test_str_not_generated_by_default(self):
        src = ClassWizard("Baz").generate()
        assert "__str__" not in src

    def test_str_generated_when_requested(self):
        fields = [FieldSpec("val", "int")]
        src = ClassWizard("Baz", fields, generate_str=True).generate()
        assert "def __str__(self) -> str:" in src

    def test_base_classes(self):
        src = ClassWizard("Child", base_classes=["Base"]).generate()
        assert "class Child(Base):" in src

    def test_docstring(self):
        src = ClassWizard("Doc", class_docstring="My docstring.").generate()
        assert '"""My docstring."""' in src

    def test_default_values_in_init(self):
        fields = [FieldSpec("count", "int", default="0")]
        src = ClassWizard("Counter", fields).generate()
        assert "count: int = 0" in src

    def test_generated_code_is_valid_python(self):
        fields = [FieldSpec("name", "str"), FieldSpec("age", "int", default="0")]
        src = ClassWizard("Person", fields, class_docstring="A person.").generate()
        # Should not raise
        compile(src, "<string>", "exec")

    def test_any_import_added_when_needed(self):
        src = ClassWizard("Foo", [FieldSpec("x")]).generate()
        assert "from typing import Any" in src

    def test_no_any_import_when_not_needed(self):
        src = ClassWizard("Foo", [FieldSpec("x", "int")]).generate()
        assert "from typing import Any" not in src


# ---------------------------------------------------------------------------
# ClassWizard – dataclass mode
# ---------------------------------------------------------------------------


class TestClassWizardDataclass:
    def test_decorator_present(self):
        src = ClassWizard("DC", mode=ClassMode.DATACLASS).generate()
        assert "@dataclass" in src
        assert "from dataclasses import dataclass, field" in src

    def test_fields_as_annotations(self):
        fields = [FieldSpec("x", "int"), FieldSpec("y", "str", default='"hello"')]
        src = ClassWizard("DC", fields, mode=ClassMode.DATACLASS).generate()
        assert "x: int" in src
        assert 'y: str = "hello"' in src

    def test_generated_code_is_valid_python(self):
        fields = [FieldSpec("val", "float", default="1.0")]
        src = ClassWizard("Config", fields, mode=ClassMode.DATACLASS).generate()
        compile(src, "<string>", "exec")


# ---------------------------------------------------------------------------
# ClassWizard – namedtuple mode
# ---------------------------------------------------------------------------


class TestClassWizardNamedTuple:
    def test_inherits_namedtuple(self):
        src = ClassWizard("NT", mode=ClassMode.NAMEDTUPLE).generate()
        assert "class NT(NamedTuple):" in src
        assert "from typing import NamedTuple" in src

    def test_fields_as_annotations(self):
        fields = [FieldSpec("x", "int"), FieldSpec("y", "int", default="0")]
        src = ClassWizard("Point", fields, mode=ClassMode.NAMEDTUPLE).generate()
        assert "x: int" in src
        assert "y: int = 0" in src

    def test_generated_code_is_valid_python(self):
        fields = [FieldSpec("a", "str"), FieldSpec("b", "int")]
        src = ClassWizard("Row", fields, mode=ClassMode.NAMEDTUPLE).generate()
        compile(src, "<string>", "exec")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


class TestCLI:
    def test_basic_class(self, capsys):
        rc = main(["MyClass"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "class MyClass:" in out

    def test_fields_via_cli(self, capsys):
        rc = main(["Person", "name:str", "age:int=0"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "self.name = name" in out
        assert "age: int = 0" in out

    def test_dataclass_mode(self, capsys):
        rc = main(["Config", "debug:bool=False", "--mode", "dataclass"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "@dataclass" in out

    def test_namedtuple_mode(self, capsys):
        rc = main(["Color", "r:int", "g:int", "b:int", "--mode", "namedtuple"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "NamedTuple" in out

    def test_invalid_class_name(self, capsys):
        rc = main(["123invalid"])
        assert rc == 1
        err = capsys.readouterr().err
        assert "error:" in err

    def test_no_repr_flag(self, capsys):
        rc = main(["Foo", "--no-repr"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "__repr__" not in out

    def test_no_eq_flag(self, capsys):
        rc = main(["Foo", "--no-eq"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "__eq__" not in out

    def test_str_flag(self, capsys):
        rc = main(["Foo", "val:int", "--str"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "__str__" in out

    def test_docstring_flag(self, capsys):
        rc = main(["Foo", "--docstring", "A foo class."])
        assert rc == 0
        out = capsys.readouterr().out
        assert "A foo class." in out

    def test_output_file(self, tmp_path, capsys):
        outfile = tmp_path / "out.py"
        rc = main(["Foo", "--output", str(outfile)])
        assert rc == 0
        assert outfile.exists()
        assert "class Foo:" in outfile.read_text()

    def test_base_class_flag(self, capsys):
        rc = main(["Child", "--base", "Base"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "class Child(Base):" in out
