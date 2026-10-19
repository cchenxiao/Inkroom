# README 图表

项目首页使用本目录中的静态 SVG，避免依赖 GitHub 的 Mermaid 富内容渲染。SVG 内包含标题、描述和中文字体回退，适配浅色与深色页面背景。

- `*.mmd`：保留的 Mermaid 流程与架构源文件。
- `render.py`：静态排版与 SVG 生成器，只依赖 Python 标准库。
- `*.svg`：已提交的实际展示资源。

更新图表时同步维护 Mermaid 的流程关系和生成器中的展示内容，然后在项目根目录执行：

```bash
python3 docs/diagrams/render.py
```

提交前检查 SVG 文字、连线，以及 GitHub README 的图片加载。只修改 Mermaid 文件不会自动更新 SVG。
