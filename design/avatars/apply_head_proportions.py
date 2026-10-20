"""Apply the app's head proportions to the SVG master.

The desktop pet squashes the whole head vertically (``HEAD_SQUASH`` in
``desktop/src/mochi/whale-avatar.ts``) because the raw artwork was nearly
square (607 x 590) and read as an upright slab. Icons must show the same
character, so the same transform is baked into the vector master here:

  * every layer is wrapped in one group: uniform 1.045 with y multiplied by
    0.86, about the artwork's centre — the head fills the 640 viewBox width
    and lands at roughly 636 x 530;
  * the eyes get a counter-scale in y, exactly like the engine's callback, so
    they stay round instead of being pinched by the squash.

    python design/avatars/apply_head_proportions.py

Idempotent: it rewrites from the current file only if the group is absent.
"""

from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SVG = HERE / "blue-maid.svg"

VIEW = 640.0
PIVOT_X = 320.0
PIVOT_Y = 312.0

UNIFORM = 1.045
SQUASH = 0.86
SCALE_Y = UNIFORM * SQUASH

# Eyes: the rect stays 89 tall and a local y counter-scale keeps it there;
# width is pre-widened so the squash leaves it ~49 instead of 42.
EYE_W = 46.7
EYE_H = 89.0
EYE_R = EYE_W / 2
COUNTER_Y = 1.0 / SCALE_Y
EYE_CENTRES = [(232.0, 405.0), (401.0, 405.0)]

HEAD_OPEN = (
    f'  <g id="head" transform="translate(320 320) '
    f'scale({UNIFORM} {SCALE_Y:.4f}) translate(-320 -{PIVOT_Y:g})">\n'
)
HEAD_CLOSE = "  </g>\n"


def eye_rects() -> str:
    out = []
    for i, (cx, cy) in enumerate(EYE_CENTRES):
        side = "left" if i == 0 else "right"
        out.append(
            f'      <g transform="translate({cx:g} {cy:g}) scale(1 {COUNTER_Y:.4f}) '
            f'translate(-{cx:g} -{cy:g})">\n'
            f'        <rect id="eye-{side}" x="{cx - EYE_R:.1f}" y="{cy - EYE_H / 2:.1f}" '
            f'width="{EYE_W:g}" height="{EYE_H:g}" rx="{EYE_R:.1f}" '
            f'transform="rotate(5 {cx:g} {cy:g})"/>\n'
            f'      </g>\n'
        )
    return "".join(out)


def main() -> None:
    text = SVG.read_text(encoding="utf-8")
    if '<g id="head"' in text:
        print("head group already applied — nothing to do")
        return

    # Replace the two eye rects with counter-scaled versions.
    text = re.sub(
        r'\s*<rect id="eye-left".*?/>\n\s*<rect id="eye-right".*?/>\n',
        "\n" + eye_rects(),
        text,
        flags=re.S,
    )

    # Wrap every drawing group (everything after </defs>) in the head group.
    head, sep, rest = text.partition("</defs>\n")
    if not sep:
        raise SystemExit("could not find </defs> to anchor the wrapper")
    body, sep2, tail = rest.rpartition("</svg>")
    if not sep2:
        raise SystemExit("could not find </svg>")

    indented = "".join("  " + line if line.strip() else line for line in body.splitlines(keepends=True))
    SVG.write_text(head + "</defs>\n" + HEAD_OPEN + indented + HEAD_CLOSE + "</svg>\n", encoding="utf-8")
    print(f"wrapped head group; eyes counter-scaled by {COUNTER_Y:.4f}")


if __name__ == "__main__":
    main()
