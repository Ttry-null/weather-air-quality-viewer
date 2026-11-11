# -*- coding: utf-8 -*-
"""
build_single.py —— 把整个站点打包成单个自包含 HTML(index.single.html)

打包内容:CSS、charts.js、app.js、字体(转 base64 内联)、网页图标(转 data URI 内联)。
生成结果可以单独拷到任何位置,双击即可打开(无需其他文件、无需服务器)。

用法:
    python build_single.py
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent


def data_uri(path: pathlib.Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "style.css").read_text(encoding="utf-8")
    charts = (ROOT / "charts.js").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")

    # 字体 → base64 内联
    font_dir = ROOT / "fonts"
    if font_dir.is_dir():
        for f in sorted(font_dir.glob("*.woff2")):
            css = css.replace(f'url("fonts/{f.name}")', f'url("{data_uri(f, "font/woff2")}")')

    # 图标 → data URI 内联
    svg_uri = data_uri(ROOT / "favicon.svg", "image/svg+xml")
    png_uri = data_uri(ROOT / "favicon.png", "image/png")
    apple_uri = data_uri(ROOT / "apple-touch-icon.png", "image/png")
    html = html.replace('href="favicon.svg"', f'href="{svg_uri}"')
    html = html.replace('src="favicon.svg"', f'src="{svg_uri}"')
    html = html.replace('href="favicon.png"', f'href="{png_uri}"')
    html = html.replace('href="apple-touch-icon.png"', f'href="{apple_uri}"')

    # CSS / JS 内联
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>")
    html = html.replace('<script src="charts.js"></script>', f"<script>\n{charts}\n</script>")
    html = html.replace('<script src="app.js"></script>', f"<script>\n{app}\n</script>")

    out = ROOT / "index.single.html"
    out.write_text(html, encoding="utf-8")
    size_kb = out.stat().st_size / 1024
    print(f"已生成:{out}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
