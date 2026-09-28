"""把 visual-studio 的参考图压缩成小程序可打包的尺寸。

原图 2.4–5.7MB / 张，合计 33MB，远超微信小程序主包 2MB 上限。
这里统一压到宽 640px、JPEG q74，兼顾结果页 2 倍屏显示与包体。

收两类：
  product-*-reference.png —— 产品替换模板的场景参考图
  avatar-*.png            —— 头像模板的示例封面（本身就是 1:1 方图，压完仍是方图）
"""
from pathlib import Path

from PIL import Image

SRC = Path(r"C:\Users\Sunyan win\Documents\Codex\2026-09-13\wo\work\visual-studio\public\assets")
DST = Path(r"C:\Users\Sunyan win\Documents\Codex\2026-09-13\wo\forme-taro\src\assets")
TARGET_WIDTH = 640
QUALITY = 74

DST.mkdir(parents=True, exist_ok=True)

total_before = 0
total_after = 0

for pattern in ("product-*-reference.png", "avatar-*.png"):
    for src in sorted(SRC.glob(pattern)):
        before = src.stat().st_size
        total_before += before

        with Image.open(src) as img:
            img = img.convert("RGB")
            if img.width > TARGET_WIDTH:
                height = round(img.height * TARGET_WIDTH / img.width)
                img = img.resize((TARGET_WIDTH, height), Image.LANCZOS)
            out = DST / f"{src.stem}.jpg"
            img.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)

        after = out.stat().st_size
        total_after += after
        print(f"{src.name:44s} {before / 1024:8.0f} KB -> {after / 1024:6.0f} KB  ({out.name})")

print("-" * 78)
print(f"合计 {total_before / 1024 / 1024:.1f} MB -> {total_after / 1024:.0f} KB")
