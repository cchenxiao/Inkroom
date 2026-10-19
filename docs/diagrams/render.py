"""Generate the README's dependency-free SVG diagrams: python3 docs/diagrams/render.py."""
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'


def canvas(width, height, title, description):
    return [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">
<title id="title">{escape(title)}</title><desc id="desc">{escape(description)}</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#52746c"/></marker></defs>
<rect width="{width}" height="{height}" rx="20" fill="#faf8f2"/>
<g font-family='{FONT}' fill="#283c36">''']


def text(parts, x, y, value, size=18, color='#283c36', weight=400, anchor='middle'):
    parts.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(value)}</text>')


def card(parts, x, y, w, h, title, subtitle='', accent=False):
    fill = '#eaf2ed' if accent else '#fffefa'
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="#b6c9bf" stroke-width="1.5"/>')
    text(parts, x+w/2, y+(h/2+7 if not subtitle else 29), title, 20, weight=600)
    if subtitle:
        text(parts, x+w/2, y+53, subtitle, 15, '#63776f')


def arrow(parts, path, dashed=False):
    dash = ' stroke-dasharray="6 5"' if dashed else ''
    parts.append(f'<path d="{path}" fill="none" stroke="#52746c" stroke-width="2"{dash} marker-end="url(#arrow)"/>')


def save(name, parts):
    (ROOT / name).write_text('\n'.join(parts) + '\n</g></svg>\n', encoding='utf-8')


def workflow():
    parts = canvas(1040, 820, 'Inkloom 创作流程', '确认规划后生成并审查候选；作者修改后复检，采用后整章复审、核对事实并定稿；下一章承接已确认材料。')
    text(parts, 40, 42, '创作流程 · 从规划到下一章', 24, weight=700, anchor='start')
    rows = [
        (76, '01  确认立意、风格与人物世界', '作者确认创作方向和约束'),
        (164, '02  确认章纲与本章细纲', '组织场景、情节段和篇幅目标'),
        (252, '03  生成与审查候选', '上下文装配 → 单段 / 整章生成 → 一致性与语言审查'),
        (340, '04  作者审阅与修改对照', '在原文旁核对证据、比较 diff，决定是否采用'),
        (452, '05  采用段落，整章组稿与复审', '采用段落不等于整章定稿'),
        (540, '06  作者通过复审，核对章末事实', '决定计入 / 排除，并确认人物知情范围'),
        (628, '07  确认整章定稿', '冻结正文、复审、作者决定和事实来源'),
        (716, '08  承接前章材料，继续下一章', '前章定稿结尾 + 已确认事实 + 后续章纲'),
    ]
    for i,(y,title,subtitle) in enumerate(rows):
        card(parts, 190, y, 540, 68, title, subtitle, accent=i in (3,6))
        if i+1<len(rows):arrow(parts, f'M460 {y+68} V{rows[i+1][0]-4}')
    text(parts, 492, 430, '采用', 15, '#52746c')
    card(parts, 780, 342, 230, 90, '修改候选', '选区 / 直接编辑 / 整段改写')
    arrow(parts, 'M730 372 H776')
    text(parts, 868, 326, '需要修改', 15, '#52746c')
    arrow(parts, 'M895 342 V286 H734', True)
    text(parts, 865, 269, '修改后统一复检', 15, '#52746c')
    arrow(parts, 'M190 750 H88 V198 H186', True)
    text(parts, 132, 460, '下一章', 15, '#52746c')
    save('creation-workflow.svg', parts)


def architecture():
    parts = canvas(1180, 810, 'Inkloom 系统架构', 'React 工作台通过 HTTP 调用 Go 服务，由 Eino 编排模型与检索；PostgreSQL 保存版本和事件，SSE 将持久化事件送回界面。')
    text(parts, 40, 42, '系统架构 · 模型执行与作者决定分离', 24, weight=700, anchor='start')
    for x,y,w,h,title,subtitle,accent in [
        (355,82,470,72,'React / Tiptap 作者工作台','正文、问题定位、修改对照与作者操作',True),
        (355,200,470,68,'Go HTTP API','版本化请求与人工动作入口',False),
        (355,314,470,68,'应用服务','规划 · 写作 · 复审 · 事实 · 定稿',False),
        (355,428,470,72,'Eino 编排与运行状态','有界修订、作者决策、checkpoint',True),
        (355,558,470,68,'Writer / Critic / Reviser','结构化输出、引用证据与修改范围校验',False),
        (355,690,470,68,'模型接口','DeepSeek / Fake',False),
        (880,428,270,72,'上下文与受限检索','作品 / 分支 / 时点 / POV',False),
        (880,558,270,86,'PostgreSQL + pgvector','稿本、事实、记录与向量',True),
        (30,314,260,72,'持久化事件 / SSE','断线衔接与进度更新',False),
    ]:
        card(parts,x,y,w,h,title,subtitle,accent)
    arrow(parts,'M590 154 V196');text(parts,650,183,'HTTP 人工动作',14,'#63776f')
    arrow(parts,'M590 268 V310')
    arrow(parts,'M590 382 V424')
    arrow(parts,'M590 500 V554')
    arrow(parts,'M590 626 V686')
    arrow(parts,'M825 464 H876')
    arrow(parts,'M1015 500 V554')
    arrow(parts,'M825 350 H1162 V600 H1154')
    text(parts,1040,337,'应用数据持久化',14,'#63776f')
    arrow(parts,'M810 500 V526 H918 V554')
    text(parts,860,546,'运行状态',14,'#63776f')
    arrow(parts,'M1015 644 V782 H160 V390')
    text(parts,920,770,'事件与来源记录',14,'#63776f')
    arrow(parts,'M160 314 V118 H351')
    text(parts,240,100,'SSE 运行进度',14,'#63776f')
    save('system-architecture.svg', parts)


if __name__ == '__main__':
    workflow()
    architecture()
