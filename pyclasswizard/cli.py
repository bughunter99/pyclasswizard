"""Command-line interface for pyclasswizard."""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from .wizard import ClassMode, ClassWizard, FieldSpec


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pyclasswizard",
        description=(
            "Generate Python class boilerplate from a simple specification.\n\n"
            "FIELD FORMAT\n"
            "  name           – field with type 'Any'\n"
            "  name:type      – field with explicit type hint\n"
            "  name:type=val  – field with type hint and default value"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("class_name", help="Name of the class to generate")
    parser.add_argument(
        "fields",
        nargs="*",
        metavar="FIELD",
        help="Field specifications (e.g. 'name:str' 'age:int=0')",
    )
    parser.add_argument(
        "--mode",
        choices=[m.value for m in ClassMode],
        default=ClassMode.REGULAR.value,
        help="Class generation mode (default: regular)",
    )
    parser.add_argument(
        "--base",
        dest="base_classes",
        metavar="BASE",
        action="append",
        default=[],
        help="Base class(es) to inherit from (can be repeated)",
    )
    parser.add_argument(
        "--docstring",
        metavar="TEXT",
        default=None,
        help="Docstring to include in the generated class",
    )
    parser.add_argument(
        "--no-repr",
        dest="generate_repr",
        action="store_false",
        default=True,
        help="Suppress __repr__ generation (regular mode only)",
    )
    parser.add_argument(
        "--no-eq",
        dest="generate_eq",
        action="store_false",
        default=True,
        help="Suppress __eq__ generation (regular mode only)",
    )
    parser.add_argument(
        "--str",
        dest="generate_str",
        action="store_true",
        default=False,
        help="Generate __str__ method (regular mode only)",
    )
    parser.add_argument(
        "--output",
        "-o",
        metavar="FILE",
        default=None,
        help="Write output to FILE instead of stdout",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        fields = [FieldSpec.from_string(f) for f in args.fields]
        wizard = ClassWizard(
            class_name=args.class_name,
            fields=fields,
            mode=ClassMode(args.mode),
            base_classes=args.base_classes,
            class_docstring=args.docstring,
            generate_repr=args.generate_repr,
            generate_eq=args.generate_eq,
            generate_str=args.generate_str,
        )
        source = wizard.generate()
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(source)
        print(f"Written to {args.output}")
    else:
        print(source, end="")

    return 0


if __name__ == "__main__":
    sys.exit(main())
